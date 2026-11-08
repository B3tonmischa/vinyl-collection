// Finds a record in a photo or video frame. Pure TypeScript, so it runs in a
// plain module worker (disc-detect.worker.ts) without OpenCV and on real
// photos in the specs. Measurements of what it has to cope with are in
// disc-detect.spec.ts.
//
// A generic circle search doesn't work here. The streaks on a splatter record
// put an edge on any circle inside it, a white record on a white sleeve has
// hardly any rim, and a record shot at an angle is an ellipse, with its label
// well off the rim's centre. What every record does have is concentric edges:
//
//   1. Every edge votes for the points its normal runs through, and the
//      centre is where votes from all directions meet (findCentres).
//   2. Around each centre the edges that run around it are unwrapped into
//      angle/radius, and the best closed path through them is traced
//      (polarEdges, tracePath). A path can follow an ellipse or a rim seen
//      from a centre that's somewhat off.
//   3. A path gets a smooth outline fitted, the outline moves the centre, and
//      the trace repeats on the outline (fitOutline, settleRim).
//   4. The best-covered, largest outline is the rim (pickRim).

import { Circle, Point, Size } from './camera-capture.logic';
import { Pixels } from './sleeve-refine';

/** Longest edge of the copy the search runs on. A rim needs no more, and creases do. */
const WORK_EDGE = 400;
/** Rays around a centre. */
const ANGLES = 144;
/** Most centres traced, as well as the middle of the frame. */
const MAX_CENTRES = 6;
/** Radius limits, as shares of the frame's shorter side. */
const MIN_RADIUS = 0.18;
const MAX_RADIUS = 0.55;
/** Votes start this far from an edge, as a share of the frame's shorter side. */
const MIN_VOTE_DISTANCE = 0.04;
/** Centres at least this far apart, as a share of the frame's shorter side. */
const CENTRE_SPACING = 0.08;
/** Size of the surroundings a centre has to stand out from, likewise. */
const CENTRE_SURROUND = 0.035;
/** An edge counts for a ray only if it runs around the centre to within this cosine. */
const MIN_ALIGNMENT = 0.8;
// Traced radius windows: each is WINDOW_SPAN times as wide as it starts,
// and the next starts WINDOW_STEP times further out.
const WINDOW_SPAN = 1.35;
const WINDOW_STEP = 1.2;
/** Largest radius change, in pixels, from one ray to the next. */
const MAX_PATH_STEP = 2;
/** Score lost per pixel of radius change, so a path stays smooth over gaps. */
const PATH_BEND_COST = 0.3;
/** Rays further than this from a path's median radius, as a share of it, don't start the fit. */
const MAX_STRAY = 0.15;
/** Share of rays a traced path must have on edges to be worth fitting. */
const MIN_TRACE_COVERAGE = 0.25;
/** Outlines kept for settling. */
const MAX_SETTLED = 8;
/** Outlines closer than this, as a share of the radius, count as the same one. */
const SAME_OUTLINE = 0.04;
/** Settling rounds, and how far each searches, as shares of the radius. */
const SETTLE_SPANS = [0.05, 0.03];
/** A settling round is thrown away if it loses more than this share of the coverage. */
const SETTLE_MAX_LOSS = 0.2;
/** Widest lip a traced rim can move across, as a share of the radius. */
const LIP_REACH = 0.07;
/** Brightness, out of 255, by which the lip must differ from what's behind the record. */
const LIP_CONTRAST = 6;

/** Least share of rays on the outline for it to count as a rim. */
export const MIN_COVERAGE = 0.6;
/** Longest stretch of rim allowed to show no edge, as a share of the rays. */
export const MAX_GAP = 0.3;
/** Most out-of-round an outline can be, as (long axis − short axis) / (2 × mean radius). */
export const MAX_ELLIPTICITY = 0.11;
/** How far a record may stick out of the frame, as a share of its radius. */
export const MAX_OVERHANG = 0.05;

// Harmonics of the outline, r(a) = c0 + c1 cos a + c2 sin a + c3 cos 2a + c4 sin 2a:
// c0 is the mean radius, c1 and c2 move the centre, c3 and c4 make it oval.
const HARMONICS = 5;
const BASIS = (() => {
  const basis = new Float64Array(ANGLES * HARMONICS);
  for (let k = 0; k < ANGLES; k++) {
    const a = (2 * Math.PI * k) / ANGLES;
    basis.set([1, Math.cos(a), Math.sin(a), Math.cos(2 * a), Math.sin(2 * a)], k * HARMONICS);
  }
  return basis;
})();

/** A record found in a photo, in the photo's pixels. */
export interface FoundDisc {
  /** The rim as a circle: its outline's centre and mean radius. */
  circle: Circle;
  /** Points on the rim. */
  rim: Point[];
  /** Points on a ring concentric with it, such as the label's edge, if one was found. */
  ring: Point[] | null;
}

/** A candidate rim, in pixels of the working copy. */
export interface RimCandidate extends Circle {
  /** Share of the rays where the outline lies on an edge. */
  coverage: number;
  /** Longest stretch without one, as a share of the rays. */
  gap: number;
  /** (long axis − short axis) / (2 × mean radius). */
  ellipticity: number;
}

interface WorkingCopy extends Size {
  /** Pixels of the source per pixel of this copy. */
  scale: number;
  channels: [Float32Array, Float32Array, Float32Array];
}

/** Per-pixel gradient of whichever color channel changes most. */
interface EdgeField extends Size {
  gx: Float32Array;
  gy: Float32Array;
  magnitude: Float32Array;
  /** Softened brightness. */
  brightness: Float32Array;
}

/** Edges running around a centre: rows are rays, columns are radii. */
interface PolarEdges {
  values: Float32Array;
  /** Whether each edge gets brighter going outward. */
  brightening: Uint8Array;
  radii: number;
}

interface Outline {
  coefficients: Float64Array;
  coverage: number;
  gap: number;
  /** 1 for the rays whose path lies on the outline, else 0. */
  onOutline: Float64Array;
}

interface Traced extends RimCandidate {
  c3: number;
  c4: number;
  /** Where the outline lies on an edge, once settled. */
  points: Point[];
}

/** Box-filtered copy with its longer edge at `maxEdge`, or at the source's size if smaller. */
export function workingCopy(image: Pixels, maxEdge = WORK_EDGE): WorkingCopy {
  const scale = Math.max(1, Math.max(image.width, image.height) / maxEdge);
  const width = Math.round(image.width / scale);
  const height = Math.round(image.height / scale);
  const channels: WorkingCopy['channels'] = [
    new Float32Array(width * height),
    new Float32Array(width * height),
    new Float32Array(width * height),
  ];
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * scale)));
      const sum = [0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          sum[0] += image.data[i];
          sum[1] += image.data[i + 1];
          sum[2] += image.data[i + 2];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 3; c++) channels[c][y * width + x] = sum[c] / count;
    }
  }
  return { width, height, scale, channels };
}

/** 1-2-1 blur in both directions. */
function soften(source: Float32Array, { width, height }: Size): Float32Array {
  const across = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = source[row + Math.max(0, x - 1)];
      const right = source[row + Math.min(width - 1, x + 1)];
      across[row + x] = (left + 2 * source[row + x] + right) / 4;
    }
  }
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      out[row + x] = (across[up + x] + 2 * across[row + x] + across[down + x]) / 4;
    }
  }
  return out;
}

/** Mean over a square of side 2·radius+1, cut off at the image's border. */
function boxMean(source: Float32Array, { width, height }: Size, radius: number): Float32Array {
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += source[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1];
      out[y * width + x] =
        (sum - sums[y1 * stride + x0] + sums[y0 * stride + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function edgeField(copy: WorkingCopy): EdgeField {
  const { width, height } = copy;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);
  const channels = copy.channels.map((channel) => soften(channel, copy));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let best = 0;
      for (const c of channels) {
        const dx =
          (c[i + 1 - width] +
            2 * c[i + 1] +
            c[i + 1 + width] -
            (c[i - 1 - width] + 2 * c[i - 1] + c[i - 1 + width])) /
          8;
        const dy =
          (c[i + width - 1] +
            2 * c[i + width] +
            c[i + width + 1] -
            (c[i - width - 1] + 2 * c[i - width] + c[i - width + 1])) /
          8;
        const squared = dx * dx + dy * dy;
        if (squared > best) {
          best = squared;
          gx[i] = dx;
          gy[i] = dy;
        }
      }
      magnitude[i] = Math.sqrt(best);
    }
  }
  const brightness = channels[0].map((r, i) => (r + channels[1][i] + channels[2][i]) / 3);
  return { width, height, gx, gy, magnitude, brightness };
}

/**
 * How strong an edge must be, from the photo's own texture. Voting wants real
 * edges only; a rim is checked for direction as well, so it can go lower, which
 * a white record on a white sleeve needs.
 */
function edgeLevels(field: EdgeField): { vote: number; rim: number } {
  const sample: number[] = [];
  for (let i = 0; i < field.magnitude.length; i += 7) sample.push(field.magnitude[i]);
  sample.sort((a, b) => a - b);
  const median = sample[sample.length >> 1] ?? 0;
  return {
    vote: Math.min(Math.max(median * 2.5, 1.2), 6),
    rim: Math.min(Math.max(median * 1.2, 1), 3),
  };
}

/**
 * How likely each pixel is to be a record's centre. Each edge votes along its normal, into one of
 * four maps by direction. A circle votes from every direction, a fold in a
 * sheet from one or two, so a centre has to stand out in all four. It also has
 * to stand out from its surroundings: clutter spreads its votes while a circle
 * focuses them.
 */
export function centreVotes(field: EdgeField, level: number): Float32Array {
  const { width, height, gx, gy, magnitude } = field;
  const shortSide = Math.min(width, height);
  const maps = [0, 1, 2, 3].map(() => new Float32Array(width * height));
  const nearest = Math.round(shortSide * MIN_VOTE_DISTANCE);
  const furthest = Math.round(shortSide * MAX_RADIUS);
  const weights = new Float32Array(furthest + 1);
  for (let r = 1; r <= furthest; r++) weights[r] = 1 / Math.sqrt(r);

  // Half the edges, voting on every other pixel: the map gets blurred anyway.
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2 + (y & 1); x < width - 2; x += 2) {
      const i = y * width + x;
      const m = magnitude[i];
      if (m < level) continue;
      const peak =
        m >= magnitude[i - 1] ||
        m >= magnitude[i + 1] ||
        m >= magnitude[i - width] ||
        m >= magnitude[i + width];
      if (!peak) continue;
      const ux = gx[i] / m;
      const uy = gy[i] / m;
      const strength = Math.min(m, level * 4);
      const angle = (Math.atan2(uy, ux) + Math.PI) % Math.PI;
      const map = maps[Math.min(3, Math.floor(angle / (Math.PI / 4)))];
      for (const side of [1, -1]) {
        for (let r = nearest; r <= furthest; r += 2) {
          const px = Math.round(x + side * ux * r);
          const py = Math.round(y + side * uy * r);
          if (px < 0 || py < 0 || px >= width || py >= height) break;
          map[py * width + px] += strength * weights[r];
        }
      }
    }
  }

  const surround = Math.round(shortSide * CENTRE_SURROUND);
  const standout = maps.map((map) => {
    const near = soften(soften(soften(map, field), field), field);
    const around = boxMean(near, field, surround);
    return near.map((v, i) => Math.max(0, v - around[i]));
  });
  const score = new Float32Array(width * height);
  for (let i = 0; i < score.length; i++) {
    score[i] = (standout[0][i] * standout[1][i] * standout[2][i] * standout[3][i]) ** 0.25;
  }
  return score;
}

/**
 * The best `count` peaks of centreVotes, at least `spacing` apart, and only
 * within `area` if given.
 */
function pickCentres(
  score: Float32Array,
  { width, height }: Size,
  count: number,
  spacing: number,
  area?: Circle,
): { x: number; y: number }[] {
  const ranked: { x: number; y: number; value: number }[] = [];
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 4; x += 2) {
      const value = score[y * width + x];
      if (value <= 0) continue;
      if (area && Math.hypot(x - area.cx, y - area.cy) > area.r) continue;
      ranked.push({ x, y, value });
    }
  }
  ranked.sort((a, b) => b.value - a.value);

  const centres: { x: number; y: number }[] = [];
  for (const { x, y } of ranked) {
    if (centres.length >= count) break;
    if (centres.some((c) => Math.hypot(c.x - x, c.y - y) < spacing)) continue;
    let dx = 0;
    let dy = 0;
    let sum = 0;
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const v = score[(y + j) * width + x + i];
        dx += i * v;
        dy += j * v;
        sum += v;
      }
    }
    centres.push({ x: x + dx / sum, y: y + dy / sum });
  }
  return centres;
}

/** Edges that run around `centre`, out to `reach`, at their (capped) strength along each ray. */
function polarEdges(
  field: EdgeField,
  centre: { x: number; y: number },
  level: number,
  reach: number,
): PolarEdges {
  const { width, height, gx, gy, magnitude } = field;
  const radii = Math.ceil(reach);
  const values = new Float32Array(ANGLES * radii);
  const brightening = new Uint8Array(ANGLES * radii);
  const cap = level * 5;
  for (let k = 0; k < ANGLES; k++) {
    const ux = BASIS[k * HARMONICS + 1];
    const uy = BASIS[k * HARMONICS + 2];
    for (let r = 0; r < radii; r++) {
      const x = Math.round(centre.x + ux * r);
      const y = Math.round(centre.y + uy * r);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const i = y * width + x;
      const m = magnitude[i];
      if (m < level) continue;
      const outward = gx[i] * ux + gy[i] * uy;
      const along = Math.abs(outward);
      if (along < MIN_ALIGNMENT * m) continue;
      values[k * radii + r] = Math.min(along, cap);
      brightening[k * radii + r] = outward > 0 ? 1 : 0;
    }
  }
  return { values, brightening, radii };
}

/**
 * Best closed path around the centre, within ±span of `baseline`: the radius
 * on each ray. Dynamic programming, going round twice and keeping the second
 * lap, so the path's two ends meet without fixing where it starts.
 */
export function tracePath(
  edges: Pick<PolarEdges, 'values' | 'radii'>,
  baseline: Int32Array,
  span: number,
): Int32Array {
  const { values, radii } = edges;
  const width = span * 2 + 1;
  const steps = ANGLES * 2;
  let previous = new Float32Array(width);
  let current = new Float32Array(width);
  const from = new Int16Array(steps * width);

  for (let k = 0; k < steps; k++) {
    const ray = k % ANGLES;
    const shift = baseline[ray] - baseline[(ray + ANGLES - 1) % ANGLES];
    for (let i = 0; i < width; i++) {
      const radius = baseline[ray] - span + i;
      const value = radius >= 0 && radius < radii ? values[ray * radii + radius] : 0;
      let best = -Infinity;
      let bestFrom = i;
      for (let step = -MAX_PATH_STEP; step <= MAX_PATH_STEP; step++) {
        const j = i + shift + step;
        if (j < 0 || j >= width) continue;
        const score = previous[j] - Math.abs(step) * PATH_BEND_COST;
        if (score > best) {
          best = score;
          bestFrom = j;
        }
      }
      current[i] = (best === -Infinity ? 0 : best) + value;
      from[k * width + i] = bestFrom;
    }
    [previous, current] = [current, previous];
  }

  let at = 0;
  for (let i = 1; i < width; i++) if (previous[i] > previous[at]) at = i;
  const path = new Int32Array(ANGLES);
  for (let k = steps - 1; k >= ANGLES; k--) {
    path[k % ANGLES] = baseline[k % ANGLES] - span + at;
    at = from[k * width + at];
  }
  return path;
}

/** Solves A·x = b by Gaussian elimination, or null if A is singular. Both get overwritten. */
function solve(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row * n + col]) > Math.abs(a[pivot * n + col])) pivot = row;
    }
    if (Math.abs(a[pivot * n + col]) < 1e-9) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        [a[col * n + k], a[pivot * n + k]] = [a[pivot * n + k], a[col * n + k]];
      }
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let row = col + 1; row < n; row++) {
      const factor = a[row * n + col] / a[col * n + col];
      for (let k = col; k < n; k++) a[row * n + k] -= factor * a[col * n + k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row * n + k] * x[k];
    x[row] = sum / a[row * n + row];
  }
  return x;
}

function harmonicValue(coefficients: Float64Array, ray: number): number {
  let sum = 0;
  for (let h = 0; h < HARMONICS; h++) sum += BASIS[ray * HARMONICS + h] * coefficients[h];
  return sum;
}

/** Longest circular run of rays that aren't on the outline, as a share of the rays. */
export function longestGap(onOutline: Float64Array): number {
  let longest = 0;
  let run = 0;
  for (let k = 0; k < ANGLES * 2; k++) {
    run = onOutline[k % ANGLES] > 0 ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return Math.min(longest, ANGLES) / ANGLES;
}

/**
 * Least-squares outline through a path, ignoring rays that stray from it.
 * The harmonics are linear to fit, unlike an ellipse, and for a shape this
 * close to a circle they are one: the first moves the circle, the second
 * makes it oval.
 */
export function fitOutline(path: Int32Array, edges: PolarEdges): Outline | null {
  const { values, radii } = edges;
  // A stretch far from the median radius would drag the first fit towards it,
  // and then look like the part that fits.
  const median = path.slice().sort()[ANGLES >> 1];
  const weights = new Float64Array(ANGLES);
  for (let k = 0; k < ANGLES; k++) {
    const stray = Math.abs(path[k] - median) > median * MAX_STRAY;
    weights[k] = stray ? 0 : values[k * radii + path[k]] > 0 ? 1 : 0.05;
  }

  let coefficients: Float64Array | null = null;
  for (let round = 0; round < 4; round++) {
    const a = new Float64Array(HARMONICS * HARMONICS);
    const b = new Float64Array(HARMONICS);
    for (let k = 0; k < ANGLES; k++) {
      const row = k * HARMONICS;
      for (let i = 0; i < HARMONICS; i++) {
        b[i] += weights[k] * BASIS[row + i] * path[k];
        for (let j = 0; j < HARMONICS; j++) {
          a[i * HARMONICS + j] += weights[k] * BASIS[row + i] * BASIS[row + j];
        }
      }
    }
    coefficients = solve(a, b, HARMONICS);
    if (!coefficients) return null;
    const tolerance = Math.max(1.5, coefficients[0] * 0.012) * (round < 2 ? 2 : 1);
    for (let k = 0; k < ANGLES; k++) {
      const close = Math.abs(path[k] - harmonicValue(coefficients, k)) < tolerance;
      weights[k] = close && values[k * radii + path[k]] > 0 ? 1 : 0;
    }
  }
  return {
    coefficients: coefficients as Float64Array,
    coverage: weights.reduce((sum, w) => sum + w, 0) / ANGLES,
    gap: longestGap(weights),
    onOutline: weights,
  };
}

function toTraced(outline: Outline, centre: { x: number; y: number }, path?: Int32Array): Traced {
  const [c0, c1, c2, c3, c4] = outline.coefficients;
  const points: Point[] = [];
  if (path) {
    for (let k = 0; k < ANGLES; k++) {
      if (!outline.onOutline[k]) continue;
      const row = k * HARMONICS;
      points.push({
        x: centre.x + BASIS[row + 1] * path[k],
        y: centre.y + BASIS[row + 2] * path[k],
      });
    }
  }
  return {
    points,
    cx: centre.x + c1,
    cy: centre.y + c2,
    r: c0,
    c3,
    c4,
    coverage: outline.coverage,
    gap: outline.gap,
    ellipticity: Math.hypot(c3, c4) / c0,
  };
}

/**
 * Moves a path out across a clear record's lip. Light passes through the
 * vinyl, so seen against something lighter the lip is a flat band in between,
 * its sharp edge is the inner one, and the real rim fades into the background.
 * The rim is where the background starts, then. Only for a path that gets
 * lighter outward: past a light record there's a dark band, but that's its
 * shadow, and the rim is on the near side of it.
 */
function crossLip(
  path: Int32Array,
  edges: PolarEdges,
  field: EdgeField,
  centre: { x: number; y: number },
  reach: number,
): Int32Array {
  const { width, height, brightness } = field;
  const out = path.slice();
  for (let k = 0; k < ANGLES; k++) {
    if (!edges.brightening[k * edges.radii + path[k]]) continue;
    const ux = BASIS[k * HARMONICS + 1];
    const uy = BASIS[k * HARMONICS + 2];
    const at = (r: number) => {
      const x = Math.round(centre.x + ux * r);
      const y = Math.round(centre.y + uy * r);
      return x < 0 || y < 0 || x >= width || y >= height ? NaN : brightness[y * width + x];
    };
    const beyond = (at(path[k] + reach) + at(path[k] + reach + 2)) / 2;
    if (!(beyond - at(path[k] + 2) >= LIP_CONTRAST)) continue;
    for (let r = path[k] + 3; r < path[k] + reach; r++) {
      if (at(r) >= beyond - LIP_CONTRAST / 2) {
        out[k] = r;
        break;
      }
    }
  }
  return out;
}

/**
 * Re-traces an outline from its own centre, which a tilted record's label is
 * well off. A rim also gets moved across a clear record's lip; a ring doesn't.
 */
function settleRim(
  field: EdgeField,
  candidate: Traced,
  level: number,
  reach: number,
  isRim = true,
): Traced {
  let current = candidate;
  for (const share of SETTLE_SPANS) {
    const centre = { x: current.cx, y: current.cy };
    const edges = polarEdges(field, centre, level, reach);
    const baseline = new Int32Array(ANGLES);
    for (let k = 0; k < ANGLES; k++) {
      const row = k * HARMONICS;
      baseline[k] = Math.round(
        current.r + current.c3 * BASIS[row + 3] + current.c4 * BASIS[row + 4],
      );
    }
    const span = Math.max(4, Math.round(current.r * share));
    const traced = tracePath(edges, baseline, span);
    const path = isRim
      ? crossLip(traced, edges, field, centre, Math.ceil(current.r * LIP_REACH))
      : traced;
    const outline = fitOutline(path, edges);
    if (!outline || outline.coverage < current.coverage * (1 - SETTLE_MAX_LOSS)) break;
    current = toTraced(outline, centre, path);
  }
  return current;
}

/**
 * A ring inside the rim and concentric with it: the label's edge, the dead
 * wax or a band of grooves. Any will do, as long as it's a clean circle;
 * disc-straighten.ts needs one to find the record's centre in a tilted shot.
 * It's traced from each likely centre near the rim's, since in a tilted shot
 * the label sits well off the rim's centre, but the votes find it.
 */
function findRing(
  field: EdgeField,
  rim: Traced,
  level: number,
  votes: Float32Array,
): Traced | null {
  const largest = rim.r * RING_MAX_RADIUS;
  const reach = largest * WINDOW_SPAN;
  const near = (p: { x: number; y: number }) =>
    Math.hypot(p.x - rim.cx, p.y - rim.cy) <= rim.r * RING_MAX_OFFSET;
  const likely = pickCentres(votes, field, RING_CENTRES, rim.r * RING_CENTRE_SPACING, {
    cx: rim.cx,
    cy: rim.cy,
    r: rim.r * RING_MAX_OFFSET,
  });
  let best: Traced | null = null;
  for (const centre of [{ x: rim.cx, y: rim.cy }, ...likely]) {
    const edges = polarEdges(field, centre, level, reach);
    for (let start = rim.r * RING_MIN_RADIUS; start < largest; start *= WINDOW_STEP) {
      const span = Math.max(3, Math.round((start * (WINDOW_SPAN - 1)) / 2));
      const middle = Math.round(start) + span;
      const path = tracePath(edges, new Int32Array(ANGLES).fill(middle), span);
      const outline = fitOutline(path, edges);
      if (!outline || outline.coverage < MIN_TRACE_COVERAGE) continue;
      const ring = settleRim(field, toTraced(outline, centre, path), level, reach, false);
      const clean =
        ring.coverage >= RING_MIN_COVERAGE &&
        ring.gap <= MAX_GAP &&
        ring.ellipticity <= MAX_ELLIPTICITY &&
        ring.r <= largest &&
        near({ x: ring.cx, y: ring.cy });
      if (clean && (!best || ring.coverage > best.coverage)) best = ring;
    }
  }
  return best;
}

// A ring for straightening: radius range and how far off the rim's centre it
// may be, as shares of the rim's radius, and how much of it must lie on edges.
const RING_MIN_RADIUS = 0.2;
const RING_MAX_RADIUS = 0.62;
const RING_MAX_OFFSET = 0.25;
const RING_MIN_COVERAGE = 0.75;
/** Centres a ring is traced from, besides the rim's, and how far apart, as a share of its radius. */
const RING_CENTRES = 3;
const RING_CENTRE_SPACING = 0.05;

/** Whether a candidate could be a whole record lying in this frame. */
export function isPlausibleRim(rim: RimCandidate, frame: Size): boolean {
  const slack = rim.r * MAX_OVERHANG;
  return (
    rim.coverage >= MIN_COVERAGE &&
    rim.gap <= MAX_GAP &&
    rim.ellipticity <= MAX_ELLIPTICITY &&
    rim.r >= Math.min(frame.width, frame.height) * MIN_RADIUS &&
    rim.cx - rim.r >= -slack &&
    rim.cy - rim.r >= -slack &&
    rim.cx + rim.r <= frame.width + slack &&
    rim.cy + rim.r <= frame.height + slack
  );
}

/**
 * How much a candidate looks like the rim. Coverage counts double, or a wider
 * ring that only partly lies on edges would beat a clean rim; size still
 * counts, as the label and the dead wax are clean circles inside it.
 */
function rimScore(rim: RimCandidate): number {
  return rim.coverage * rim.coverage * rim.r;
}

export function pickRim<T extends RimCandidate>(candidates: T[], frame: Size): T | null {
  const plausible = candidates.filter((c) => isPlausibleRim(c, frame));
  plausible.sort((a, b) => rimScore(b) - rimScore(a));
  return plausible[0] ?? null;
}

/** The record's rim as a circle in the pixels of `image`, or null if there's no record. */
export function detectDisc(image: Pixels): Circle | null {
  return findDisc(image)?.circle ?? null;
}

/** The record in `image`, with what straightening it needs, or null if there's no record. */
export function findDisc(image: Pixels): FoundDisc | null {
  const copy = workingCopy(image);
  const field = edgeField(copy);
  const level = edgeLevels(field);
  const shortSide = Math.min(copy.width, copy.height);
  const smallest = shortSide * MIN_RADIUS;
  const largest = shortSide * MAX_RADIUS;
  const reach = largest * WINDOW_SPAN;

  const votes = centreVotes(field, level.vote);
  const centres = pickCentres(votes, copy, MAX_CENTRES, shortSide * CENTRE_SPACING);
  // The user aims at the guide, and a tilted record's centre can vote badly.
  centres.push({ x: copy.width / 2, y: copy.height / 2 });
  const found: Traced[] = [];
  for (const centre of centres) {
    const edges = polarEdges(field, centre, level.rim, reach);
    for (let start = smallest; start < largest; start *= WINDOW_STEP) {
      const span = Math.round((start * (WINDOW_SPAN - 1)) / 2);
      const middle = Math.round(start) + span;
      const path = tracePath(edges, new Int32Array(ANGLES).fill(middle), span);
      let onEdges = 0;
      for (let k = 0; k < ANGLES; k++) if (edges.values[k * edges.radii + path[k]] > 0) onEdges++;
      if (onEdges / ANGLES < MIN_TRACE_COVERAGE) continue;
      const outline = fitOutline(path, edges);
      if (outline && outline.coverage >= MIN_TRACE_COVERAGE)
        found.push(toTraced(outline, centre, path));
    }
  }

  found.sort((a, b) => rimScore(b) - rimScore(a));
  const distinct: Traced[] = [];
  for (const candidate of found) {
    if (distinct.length >= MAX_SETTLED) break;
    const seen = distinct.some(
      (c) =>
        Math.hypot(c.cx - candidate.cx, c.cy - candidate.cy) + Math.abs(c.r - candidate.r) <
        candidate.r * SAME_OUTLINE,
    );
    if (!seen) distinct.push(candidate);
  }

  const settled = distinct.map((c) => settleRim(field, c, level.rim, reach));
  const rim = pickRim(settled, copy);
  if (!rim) return null;
  const ring = findRing(field, rim, level.rim, votes);
  // A copy pixel's center lies half a pixel in.
  const toImage = (p: Point): Point => ({
    x: (p.x + 0.5) * copy.scale,
    y: (p.y + 0.5) * copy.scale,
  });
  const centre = toImage({ x: rim.cx, y: rim.cy });
  return {
    circle: { cx: centre.x, cy: centre.y, r: rim.r * copy.scale },
    rim: rim.points.map(toImage),
    ring: ring ? ring.points.map(toImage) : null,
  };
}
