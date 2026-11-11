// Straightens a record shot at an angle, so its crop comes out round with the
// label in the middle. Pure math on 3×3 matrices, run in disc-detect.worker.ts.
//
// Tilt doesn't just squash a record into an ellipse. Its near side also looks
// bigger, which moves the ellipse's centre away from the spindle: by 14% of
// the radius on one of the example photos. Stretching the ellipse into a
// circle would leave the label that far off. What fixes it is the record's
// centre as it appears in the photo. The images of two concentric circles (the
// rim and the label's edge, say) pin that down exactly (centreOfConcentric).
// A circle's centre and its rim then fix the perspective: the polar of the
// centre is the line the record's plane vanishes at (straightening).
//
// Conics are 3×3 symmetric matrices C, row-major, with xᵀ C x = 0 on the
// outline for x = (px, py, 1). A homography H maps a conic to H⁻ᵀ C H⁻¹.

import { Circle, Point } from './camera-capture.logic';

export type Mat3 = number[];

/** How much margin the straightened image keeps around the rim, as a share of its radius. */
export const STRAIGHT_MARGIN = 1.2;
/** Below this, (long axis − short axis) / (long axis + short axis), a rim is round enough as it is. */
export const MIN_ELLIPTICITY = 0.01;
/** Most the straightened rim may stray from a circle, as a share of its radius. */
const MAX_ROUNDNESS_ERROR = 0.02;
/** Most the straightened ring may be off the rim's centre, as a share of the rim's radius. */
const MAX_RING_OFFSET = 0.03;

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) out[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    }
  }
  return out;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) return null;
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

export function apply(h: Mat3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** The conic `c` as it appears after mapping points through `h`. */
export function mapConic(c: Mat3, h: Mat3): Mat3 | null {
  const inverse = invert(h);
  return inverse && multiply(transpose(inverse), multiply(c, inverse));
}

/** A circle as a conic. */
export function circleConic({ cx, cy, r }: Circle): Mat3 {
  return [1, 0, -cx, 0, 1, -cy, -cx, -cy, cx * cx + cy * cy - r * r];
}

/** 3×3 linear solve by Cramer's rule, or null if singular. */
function solve3(m: Mat3, v: number[]): number[] | null {
  const inverse = invert(m);
  if (!inverse) return null;
  return [0, 1, 2].map(
    (i) => inverse[i * 3] * v[0] + inverse[i * 3 + 1] * v[1] + inverse[i * 3 + 2] * v[2],
  );
}

/**
 * Least-squares ellipse through points, or null if they don't make one.
 * Fitted as a u² + b uv + c v² + d u + e v = 1 in coordinates centred on the
 * points and scaled to unit size, which keeps the sums well-conditioned and
 * puts the origin inside the ellipse, where the right-hand side can't be 0.
 */
export function fitConic(points: Point[]): Mat3 | null {
  if (points.length < 6) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const scale = Math.sqrt(
    points.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / points.length,
  );
  if (!(scale > 0)) return null;
  const n = 5;
  const a = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (const p of points) {
    const u = (p.x - mx) / scale;
    const v = (p.y - my) / scale;
    const row = [u * u, u * v, v * v, u, v];
    for (let i = 0; i < n; i++) {
      b[i] += row[i];
      for (let j = 0; j < n; j++) a[i * n + j] += row[i] * row[j];
    }
  }
  const x = solveN(a, b, n);
  if (!x) return null;
  const [ca, cb, cc, cd, ce] = x;
  if (cb * cb - 4 * ca * cc >= 0) return null;
  const inUnits: Mat3 = [ca, cb / 2, cd / 2, cb / 2, cc, ce / 2, cd / 2, ce / 2, -1];
  // u = N x
  const toUnits: Mat3 = [1 / scale, 0, -mx / scale, 0, 1 / scale, -my / scale, 0, 0, 1];
  return multiply(transpose(toUnits), multiply(inUnits, toUnits));
}

function solveN(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row * n + col]) > Math.abs(a[pivot * n + col])) pivot = row;
    }
    if (Math.abs(a[pivot * n + col]) < 1e-12) return null;
    for (let k = 0; k < n; k++) {
      [a[col * n + k], a[pivot * n + k]] = [a[pivot * n + k], a[col * n + k]];
    }
    [b[col], b[pivot]] = [b[pivot], b[col]];
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

/** Centre and semi-axes of an ellipse conic, or null if it isn't one. */
export function ellipseOf(c: Mat3): { centre: Point; long: number; short: number } | null {
  const centre = solve3([c[0], c[1], 0, c[3], c[4], 0, 0, 0, 1], [-c[2], -c[5], 1]);
  if (!centre) return null;
  const [x, y] = centre;
  // Value at the centre: the outline is where the quadratic part equals -k.
  const k = c[0] * x * x + 2 * c[1] * x * y + c[4] * y * y + 2 * c[2] * x + 2 * c[5] * y + c[8];
  const [l1, l2] = symmetricEigenvalues(c[0], c[1], c[4]);
  if (!(l1 / -k > 0 && l2 / -k > 0)) return null;
  const axes = [Math.sqrt(-k / l1), Math.sqrt(-k / l2)];
  return { centre: { x, y }, long: Math.max(...axes), short: Math.min(...axes) };
}

function symmetricEigenvalues(a: number, b: number, d: number): [number, number] {
  const mean = (a + d) / 2;
  const spread = Math.hypot((a - d) / 2, b);
  return [mean + spread, mean - spread];
}

/** Real roots of x³ + p x² + q x + r. */
function cubicRoots(p: number, q: number, r: number): number[] {
  // Depressed cubic t³ + a t + b with x = t − p/3.
  const a = q - (p * p) / 3;
  const b = (2 * p * p * p) / 27 - (p * q) / 3 + r;
  const shift = -p / 3;
  const disc = (b * b) / 4 + (a * a * a) / 27;
  if (disc > 1e-12 * Math.max(1, Math.abs(b * b))) {
    const s = Math.sqrt(disc);
    return [Math.cbrt(-b / 2 + s) + Math.cbrt(-b / 2 - s) + shift];
  }
  if (Math.abs(a) < 1e-300) return [shift, shift, shift];
  const m = 2 * Math.sqrt(-a / 3);
  const theta = Math.acos(Math.max(-1, Math.min(1, (3 * b) / (a * m)))) / 3;
  return [0, 1, 2].map((k) => m * Math.cos(theta - (2 * Math.PI * k) / 3) + shift);
}

/**
 * Where the common centre of two concentric circles appears in a photo, from
 * the ellipses they appear as. Of the three eigenvectors of outer⁻¹·inner, two
 * belong to a repeated eigenvalue and lie at infinity; the third, the odd one
 * out, is the centre. Null if the conics aren't two ellipses with a clear
 * common centre inside both.
 */
export function centreOfConcentric(outer: Mat3, inner: Mat3): Point | null {
  const outerInverse = invert(outer);
  if (!outerInverse) return null;
  const m = multiply(outerInverse, inner);
  const trace = m[0] + m[4] + m[8];
  const minors =
    m[0] * m[4] - m[1] * m[3] + (m[0] * m[8] - m[2] * m[6]) + (m[4] * m[8] - m[5] * m[7]);
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  const roots = cubicRoots(-trace, minors, -det);
  if (roots.length < 3) return null;
  // The odd one out is the root furthest from the other two.
  const odd = roots
    .map((root, i) => ({
      root,
      apart: Math.min(...roots.filter((_, j) => j !== i).map((o) => Math.abs(o - root))),
    }))
    .sort((a, b) => b.apart - a.apart)[0].root;
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[i * 3 + j] - (i === j ? odd : 0)));
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const candidates = [cross(rows[0], rows[1]), cross(rows[0], rows[2]), cross(rows[1], rows[2])];
  const v = candidates.sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0];
  if (Math.abs(v[2]) < 1e-12 * Math.hypot(...v)) return null;
  const centre = { x: v[0] / v[2], y: v[1] / v[2] };
  const inside = (c: Mat3) => {
    const e = ellipseOf(c);
    return !!e && Math.hypot(centre.x - e.centre.x, centre.y - e.centre.y) < e.short;
  };
  return inside(outer) && inside(inner) ? centre : null;
}

/** How to straighten a photo: sample it through `toPhoto` into a size×size image. */
export interface Straightening {
  /** Maps straightened pixels to photo pixels. */
  toPhoto: Mat3;
  size: number;
  /** The rim in the straightened image. */
  rim: Circle;
}

/**
 * The homography that turns the rim into a circle with `centre` (the record's
 * centre as it appears in the photo) at its middle, in a square image with
 * STRAIGHT_MARGIN around it, its radius at most `maxRadius`. Without a centre
 * it only stretches the ellipse round. Null if the rim isn't an ellipse.
 */
export function straightening(
  rim: Mat3,
  centre: Point | null,
  maxRadius: number,
): Straightening | null {
  const ellipse = ellipseOf(rim);
  if (!ellipse) return null;
  const middle = centre ?? ellipse.centre;
  // Work with the centre at the origin.
  const toOrigin: Mat3 = [1, 0, -middle.x, 0, 1, -middle.y, 0, 0, 1];
  let conic = mapConic(rim, toOrigin);
  if (!conic) return null;

  // Send the vanishing line, the centre's polar, to infinity. That keeps the
  // origin where it is and the scale around it, and leaves an ellipse centred
  // on the origin.
  let flatten: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (centre) {
    const [l0, l1, l2] = [conic[2], conic[5], conic[8]];
    if (Math.abs(l2) < 1e-12) return null;
    flatten = [1, 0, 0, 0, 1, 0, l0 / l2, l1 / l2, 1];
    conic = mapConic(conic, flatten);
    if (!conic) return null;
  }

  // An ellipse centred on the origin: xᵀ S x = 1 with S its upper 2×2 over -c₂₂.
  const k = -conic[8];
  if (!(k !== 0)) return null;
  const [sa, sb, sd] = [conic[0] / k, conic[1] / k, conic[4] / k];
  const [l1, l2] = symmetricEigenvalues(sa, sb, sd);
  if (!(l1 > 0 && l2 > 0)) return null;
  // Eigenvector of the larger eigenvalue: the short axis.
  const angle = Math.abs(sb) > 1e-15 ? Math.atan2(l1 - sa, sb) : sa >= sd ? 0 : Math.PI / 2;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const radius = Math.min(maxRadius, 1 / Math.sqrt(Math.sqrt(l1 * l2)));
  const [s1, s2] = [radius * Math.sqrt(l1), radius * Math.sqrt(l2)];
  // Rotate the axes onto x and y, scale each to the radius.
  const round: Mat3 = [s1 * cos, s1 * sin, 0, -s2 * sin, s2 * cos, 0, 0, 0, 1];
  const half = radius * STRAIGHT_MARGIN;
  const size = Math.ceil(half * 2);
  const toImage: Mat3 = [1, 0, size / 2, 0, 1, size / 2, 0, 0, 1];

  const forward = multiply(toImage, multiply(round, multiply(flatten, toOrigin)));
  const toPhoto = invert(forward);
  return toPhoto && { toPhoto, size, rim: { cx: size / 2, cy: size / 2, r: radius } };
}

/**
 * The straightening for a detected record, if it needs one and it checks out:
 * the rim must come out round, and the ring, if there's one, centred on it.
 * Falls back to stretching the rim round when the ring doesn't give a centre
 * that does.
 */
export function planStraightening(
  rimPoints: Point[],
  ringPoints: Point[] | null,
  maxRadius: number,
): Straightening | null {
  const rim = fitConic(rimPoints);
  const ellipse = rim && ellipseOf(rim);
  if (!rim || !ellipse) return null;
  if ((ellipse.long - ellipse.short) / (ellipse.long + ellipse.short) < MIN_ELLIPTICITY)
    return null;
  const ring = ringPoints && fitConic(ringPoints);
  const centre = ring ? centreOfConcentric(rim, ring) : null;

  const checks = (plan: Straightening | null, checkRing: boolean) => {
    if (!plan) return false;
    const forward = invert(plan.toPhoto);
    if (!forward) return false;
    const { cx, cy, r } = plan.rim;
    const off = (p: Point) => Math.hypot(p.x - cx, p.y - cy);
    const roundness = Math.max(...rimPoints.map((p) => Math.abs(off(apply(forward, p)) - r) / r));
    if (!(roundness <= MAX_ROUNDNESS_ERROR * 2)) return false;
    if (!checkRing || !ringPoints) return true;
    // A wrong centre leaves the ring oval or off-centre.
    const mapped = ringPoints.map((p) => apply(forward, p));
    const ringRadius = mapped.reduce((s, p) => s + off(p), 0) / mapped.length;
    const ringRoundness = Math.max(...mapped.map((p) => Math.abs(off(p) - ringRadius))) / r;
    const mx = mapped.reduce((s, p) => s + p.x, 0) / mapped.length;
    const my = mapped.reduce((s, p) => s + p.y, 0) / mapped.length;
    return ringRoundness <= MAX_RING_OFFSET && Math.hypot(mx - cx, my - cy) / r <= MAX_RING_OFFSET;
  };

  if (centre) {
    const plan = straightening(rim, centre, maxRadius);
    if (checks(plan, true)) return plan;
  }
  const stretched = straightening(rim, null, maxRadius);
  return checks(stretched, false) ? stretched : null;
}

/** Samples `image` through `toPhoto` into a size×size image, bilinearly; outside the photo repeats its edge. */
export function warpImage(
  image: { data: Uint8ClampedArray; width: number; height: number },
  toPhoto: Mat3,
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(size * size * 4);
  const [a, b, c, d, e, f, g, h, i] = toPhoto;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w = g * px + h * py + i;
      const sx = Math.min(width - 1, Math.max(0, (a * px + b * py + c) / w - 0.5));
      const sy = Math.min(height - 1, Math.max(0, (d * px + e * py + f) / w - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top =
          data[(y0 * width + x0) * 4 + ch] * (1 - fx) + data[(y0 * width + x1) * 4 + ch] * fx;
        const bottom =
          data[(y1 * width + x0) * 4 + ch] * (1 - fx) + data[(y1 * width + x1) * 4 + ch] * fx;
        out[o + ch] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}
