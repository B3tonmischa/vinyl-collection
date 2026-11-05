/*
 * Classic (non-module) web worker for camera-capture auto-crop. Lives in
 * public/ rather than src/ because it has to `importScripts` the
 * self-hosted public/vendor/opencv/opencv.js — module workers can't do
 * that, and keeping it out of the Angular build avoids wiring a worker
 * tsconfig.
 * Wrapped by src/app/admin/camera-capture/scan-detector.ts.
 *
 * Protocol: every request is { id, type, ... } and gets exactly one
 * reply { id, result } or { id, error }. Images travel as ImageData
 * (buffers transferred, not copied). All coordinates are in the pixel
 * space of the ImageData they were detected on.
 *
 * Every cv.Mat is delete()d in a finally — OpenCV.js allocates on the
 * WASM heap, and leaking full-size frames OOMs iOS Safari quickly.
 */
/* global cv, importScripts */

let ready;

function loadOpenCv() {
  if (!ready) {
    ready = new Promise((resolve, reject) => {
      try {
        importScripts('../vendor/opencv/opencv.js');
      } catch (err) {
        reject(err);
        return;
      }
      // Don't await `cv` itself: in this build it's a thenable that
      // resolves to itself, which hangs a Promise chain forever.
      if (self.cv && self.cv.Mat) resolve();
      else self.cv.onRuntimeInitialized = () => resolve();
    });
  }
  return ready;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Shoelace area of a polygon, either winding. */
function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** Clockwise around the centroid; the TS twin is orderCorners() in camera-capture.logic.ts. */
function orderClockwise(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function withMats(fn) {
  const mats = [];
  const track = (m) => {
    mats.push(m);
    return m;
  };
  try {
    return fn(track);
  } finally {
    for (const m of mats) {
      if (!m.isDeleted()) m.delete();
    }
  }
}

/*
 * Sleeve detection. A single Canny pass breaks on real photos: wood grain
 * or busy cover art merge the outline into clutter, a white sleeve on a
 * light table barely has an edge, and some sleeves differ from the table
 * only in color. So several edge/region maps are built, every large
 * contour on each is turned into a 4-corner candidate, and the main
 * thread picks the best one (pickSleeveQuad in camera-capture.logic.ts),
 * favoring candidates that several maps agree on.
 */

const MAX_CONTOURS_PER_MAP = 12;
const MIN_AREA_FRACTION = 0.06;
/** Most candidates handed back to the main thread. */
const MAX_CANDIDATES = 80;
/** Candidates whose weakest side has less edge support are dropped. */
const MIN_SUPPORT = 0.25;
// How much of a side's support is lost for an edge running on past its corners.
const OVERSHOOT_PENALTY_BOTH_ENDS = 0.8;
const OVERSHOOT_PENALTY_ONE_END = 0.5;
/** Colors further apart than this (0–255, in any channel) aren't the same edge's. */
const SAME_EDGE_COLOR_TOLERANCE = 40;
/** Lines kept for quadsFromLines. A busy room has plenty besides the sleeve's. */
const MAX_LINES = 100;
/** Line combinations that go on to full edge scoring, best first. */
const MAX_LINE_QUADS = 120;
/** A combination needs at least this share of each side on an edge. */
const MIN_LINE_SIDE_COVERAGE = 0.4;
/** Spacing, in pixels, of the coverage samples along a line. */
const COVERAGE_STEP = 2;
/** How far either side of an edge its two colors are compared, in pixels. */
const STEP_REACH = 3;
// Roughly what isPlausibleSleeveQuad accepts, in camera-capture.logic.ts:
// checked here so hopeless line combinations never reach edge scoring.
const LINE_QUAD_MAX_SIDE_RATIO = 1.7;
const LINE_QUAD_MIN_CORNER_DEG = 50;
const LINE_QUAD_MAX_CORNER_DEG = 130;

/** Binary maps whose contours may outline the sleeve. */
function buildMaps(src, track) {
  const maps = [];
  const close = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
  const anchor = new cv.Point(-1, -1);

  const gray = track(new cv.Mat());
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const blurred = track(new cv.Mat());
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // 1. Luminance edges, gaps closed so a dented outline is still one loop.
  const edges = track(new cv.Mat());
  cv.Canny(blurred, edges, 30, 90);
  // Unclosed copy for straight-line detection: closing smears grain and
  // art edges into blobs whose outlines aren't the sleeve's edges.
  const lineEdges = track(edges.clone());
  cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, close, anchor, 2);
  maps.push(edges);

  // 2. Low-contrast edges on a heavily smoothed image (white on light).
  //    The median blur flattens texture (grain, carpet) but keeps edges.
  const smooth = track(new cv.Mat());
  cv.medianBlur(gray, smooth, 7);
  const soft = track(new cv.Mat());
  cv.Canny(smooth, soft, 10, 30);
  const softLines = track(soft.clone());
  cv.morphologyEx(soft, soft, cv.MORPH_CLOSE, close, anchor, 2);
  maps.push(soft);

  // 3. Color edges: Canny per RGB channel, OR-ed — catches a red sleeve
  //    on a grey table of the same brightness.
  const channels = track(new cv.MatVector());
  cv.split(src, channels);
  const color = track(cv.Mat.zeros(src.rows, src.cols, cv.CV_8U));
  for (let i = 0; i < 3; i++) {
    const ch = track(channels.get(i));
    cv.GaussianBlur(ch, ch, new cv.Size(5, 5), 0);
    const e = track(new cv.Mat());
    cv.Canny(ch, e, 40, 120);
    cv.bitwise_or(color, e, color);
  }
  // The low-contrast edges count for lines too: a dark sleeve in front of
  // a dark shelf never reaches the thresholds of the other two maps.
  cv.bitwise_or(lineEdges, color, lineEdges);
  cv.bitwise_or(lineEdges, softLines, lineEdges);
  cv.morphologyEx(color, color, cv.MORPH_CLOSE, close, anchor, 2);
  maps.push(color);

  // 4. Otsu regions, both polarities: a light sleeve on a dark table (or
  //    vice versa) is one big blob even when its edge is blurry or shadowed.
  const otsu = track(new cv.Mat());
  cv.threshold(blurred, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(otsu, otsu, cv.MORPH_OPEN, close, anchor, 2);
  const otsuInv = track(new cv.Mat());
  cv.bitwise_not(otsu, otsuInv);
  maps.push(otsu, otsuInv);

  return { maps, lineEdges };
}

/** Least-squares line through points: { px, py, dx, dy } (unit direction). */
function fitLine(points) {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(a, b) {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Snaps a rough quad to the real outline: fits a line to the contour
 * points along the middle of each side and intersects neighbours. Fixes
 * corners cut short by approxPolyDP on rounded/worn or blurred sleeves.
 */
function refineQuad(quad, contourPts) {
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return quad;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const near = [];
    for (const p of contourPts) {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const d = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      // Middle 70% of the side, within 3% of its length.
      if (t > len * 0.15 && t < len * 0.85 && d < len * 0.03) near.push(p);
    }
    if (near.length < 5) return quad;
    lines.push(fitLine(near));
  }
  const refined = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p) return quad;
    refined.push(p);
  }
  // A corner that moved further than a fifth of a side is a bad fit.
  for (let i = 0; i < 4; i++) {
    const side = Math.hypot(quad[(i + 1) % 4].x - quad[i].x, quad[(i + 1) % 4].y - quad[i].y);
    if (Math.hypot(refined[i].x - quad[i].x, refined[i].y - quad[i].y) > side * 0.2) return quad;
  }
  return refined;
}

function matToPoints(mat) {
  const d = mat.data32S;
  const pts = [];
  for (let i = 0; i < d.length; i += 2) pts.push({ x: d[i], y: d[i + 1] });
  return pts;
}

/** Densifies a polygon so refineQuad has points along straight runs. */
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** 4-corner candidates from one contour, or none. */
function quadsFromContour(c, track) {
  const hull = track(new cv.Mat());
  cv.convexHull(c, hull, false, true);
  const peri = cv.arcLength(hull, true);
  const outline = densify(matToPoints(c), 4);
  const quads = [];
  for (const eps of [0.015, 0.03, 0.05, 0.08]) {
    const approx = track(new cv.Mat());
    cv.approxPolyDP(hull, approx, eps * peri, true);
    if (approx.rows === 4) {
      quads.push(refineQuad(orderClockwise(matToPoints(approx)), outline));
      break;
    }
  }
  // Rectangular-ish blobs that never simplify to 4 points (chipped corner,
  // a hand covering an edge): fall back to the minimum-area rectangle.
  if (quads.length === 0) {
    const rect = cv.minAreaRect(hull);
    const rectArea = rect.size.width * rect.size.height;
    if (rectArea > 0 && cv.contourArea(hull) / rectArea > 0.88) {
      quads.push(cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  return quads;
}

/**
 * Per-channel Sobel gradients (R, G, B) of the blurred image, as plain
 * arrays so edge support can be sampled cheaply from JS.
 */
function gradients(src, track) {
  const channels = track(new cv.MatVector());
  cv.split(src, channels);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const ch = track(channels.get(i));
    cv.GaussianBlur(ch, ch, new cv.Size(5, 5), 0);
    const gx = track(new cv.Mat());
    const gy = track(new cv.Mat());
    cv.Sobel(ch, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(ch, gy, cv.CV_32F, 0, 1, 3);
    out.push({ gx: gx.data32F.slice(), gy: gy.data32F.slice() });
  }
  return {
    width: src.cols,
    height: src.rows,
    channels: out,
    threshold: edgeThreshold(out),
    pixels: src.data.slice(),
  };
}

/**
 * What counts as "a real edge". A clean sleeve edge after the 5×5 blur
 * gives a Sobel response in the hundreds, but a white sleeve on a light
 * table only ~30–50. So the threshold follows the photo: a few times the
 * median gradient (≈ its texture/noise level), clamped to [18, 36]. The
 * cap matters in a busy room: clutter doesn't line up along a whole side
 * the way a real edge does, so it shouldn't raise the bar for that edge.
 */
function edgeThreshold(channels) {
  const mags = [];
  const n = channels[0].gx.length;
  for (let i = 0; i < n; i += 13) {
    let m = 0;
    for (const c of channels) m = Math.max(m, Math.hypot(c.gx[i], c.gy[i]));
    mags.push(m);
  }
  mags.sort((a, b) => a - b);
  const median = mags[Math.floor(mags.length / 2)] || 0;
  return clamp(median * 3, 18, 36);
}

/** Largest color difference between two pixels, or 0 if either is off the image. */
function colorStep(ax, ay, bx, by, grad) {
  const { width, height, pixels } = grad;
  if (ax < 0 || ay < 0 || ax >= width || ay >= height) return 0;
  if (bx < 0 || by < 0 || bx >= width || by >= height) return 0;
  const a = (ay * width + ax) * 4;
  const b = (by * width + bx) * 4;
  let most = 0;
  for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(pixels[a + c] - pixels[b + c]));
  return most;
}

/**
 * Edge response at (sx, sy) across the normal (nx, ny): the strongest
 * gradient along the normal within ±2 px, in any color channel. Only the
 * gradient component normal to the side counts, so grain lines crossing
 * a side don't. It must also be a step, with different colors either side:
 * a thin printed frame, a cable or a shelf's lip has a sharp gradient too,
 * but the same color on both sides, and isn't where a sleeve ends.
 */
function edgeResponse(sx, sy, nx, ny, grad) {
  const { width, height, channels, threshold } = grad;
  let best = 0;
  let bestX = 0;
  let bestY = 0;
  for (let o = -2; o <= 2; o++) {
    const x = Math.round(sx + nx * o);
    const y = Math.round(sy + ny * o);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    for (const c of channels) {
      const g = Math.abs(c.gx[idx] * nx + c.gy[idx] * ny);
      if (g > best) {
        best = g;
        bestX = sx + nx * o;
        bestY = sy + ny * o;
      }
    }
  }
  if (best <= threshold) return best;
  const step = colorStep(
    Math.round(bestX - nx * STEP_REACH),
    Math.round(bestY - ny * STEP_REACH),
    Math.round(bestX + nx * STEP_REACH),
    Math.round(bestY + ny * STEP_REACH),
    grad,
  );
  return step > threshold / 3 ? best : 0;
}

/** Adds the color at (x, y), if it's on the image, to `sum` = [r, g, b, count]. */
function addColor(sum, x, y, grad) {
  const { width, height, pixels } = grad;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
  const i = (iy * width + ix) * 4;
  for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
  sum[3]++;
}

/** Whether two color sums average out to about the same color. */
function sameColor(a, b) {
  if (!a[3] || !b[3]) return false;
  for (let c = 0; c < 3; c++) {
    if (Math.abs(a[c] / a[3] - b[c] / b[3]) > SAME_EDGE_COLOR_TOLERANCE) return false;
  }
  return true;
}

/**
 * Edge evidence along the stretch t0…t1 of side a→b (0 = a, 1 = b;
 * outside 0–1 is the side's extension past its corners): `hits`, the
 * share that runs along an edge across it, `strength`, the mean edge
 * response there, and the colors either side of it. The ends are skipped:
 * corners are often rounded, worn or occluded.
 */
function sideEdge(a, b, grad, t0, t1) {
  const { threshold } = grad;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const samples = 32;
  let hits = 0;
  let total = 0;
  const left = [0, 0, 0, 0];
  const right = [0, 0, 0, 0];
  for (let k = 0; k < samples; k++) {
    const t = t0 + ((t1 - t0) * (k + 0.5)) / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const best = edgeResponse(x, y, nx, ny, grad);
    if (best > threshold) {
      hits++;
      addColor(left, x - nx * STEP_REACH * 2, y - ny * STEP_REACH * 2, grad);
      addColor(right, x + nx * STEP_REACH * 2, y + ny * STEP_REACH * 2, grad);
    }
    total += Math.min(best, threshold * 6); // one hot pixel shouldn't dominate
  }
  return { hits: hits / samples, strength: total / samples, left, right };
}

/**
 * How much the edge past a corner looks like the *same* edge carrying on:
 * its hits, counted only when it's about as strong as the side itself
 * and separates the same two colors. A sleeve edge lying along a fainter
 * grain line doesn't continue, and nor does one that happens to line up
 * with a shelf behind it; a grain line, or a sleeve edge running past a
 * fake corner, does.
 */
function continuation(side, extension) {
  if (side.strength <= 0) return 0;
  if (!sameColor(side.left, extension.left) || !sameColor(side.right, extension.right)) return 0;
  const ratio = extension.strength / side.strength;
  return extension.hits * clamp((ratio - 0.5) / 0.3, 0, 1);
}

/**
 * How convincingly the quad's outline is a real edge: the weakest side's
 * edge share. A sleeve needs all four sides; a shadow's or texture blob's
 * outline is blurry or patchy on at least one of them.
 *
 * A real side also *ends* at its corners. A "side" whose edge carries on
 * past a corner is a wood-grain line or table edge, or a sleeve edge cut
 * short by a fake corner where clutter crosses it — so a strong edge on
 * the extension costs support. (Some overshoot is normal: grain or cover
 * art crossing the extension at a shallow angle.) Carrying on past both
 * ends is damning, but one end proves little: in a busy room a sleeve's
 * edge can happen to line up with a shelf behind it.
 */
function edgeSupport(quad, grad) {
  let weakest = 1;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 10) return 0;
    const on = sideEdge(a, b, grad, 0.1, 0.9);
    const before = continuation(on, sideEdge(a, b, grad, -0.3, -0.04));
    const after = continuation(on, sideEdge(a, b, grad, 1.04, 1.3));
    const excess = (overshoot) => clamp((overshoot - 0.35) / 0.65, 0, 1);
    const penalty = Math.max(
      OVERSHOOT_PENALTY_BOTH_ENDS * excess(Math.min(before, after)),
      OVERSHOOT_PENALTY_ONE_END * excess(Math.max(before, after)),
    );
    weakest = Math.min(weakest, on.hits * (1 - penalty));
    if (weakest <= MIN_SUPPORT) return weakest; // can't make the cut; skip the rest
  }
  return weakest;
}

/** Infinite line through a segment, with its length and angle. */
function segmentLine(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return {
    px: x1,
    py: y1,
    dx: (x2 - x1) / len,
    dy: (y2 - y1) / len,
    len,
    angle: Math.atan2(y2 - y1, x2 - x1),
  };
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  return d > Math.PI / 2 ? Math.PI - d : d;
}

/** Distance between two near-parallel lines (from a's anchor to b). */
function lineSeparation(a, b) {
  return Math.abs((a.px - b.px) * b.dy - (a.py - b.py) * b.dx);
}

/**
 * Straight lines in the edge map, most evidence first. A line's evidence
 * is the summed length of its segments, so a side broken up by a hand or
 * clutter still ranks by everything visible of it.
 */
function detectLines(edges, size, track) {
  const minSide = Math.min(size.width, size.height);
  const segs = track(new cv.Mat());
  cv.HoughLinesP(edges, segs, 1, Math.PI / 180, 50, minSide * 0.12, 15);
  const raw = [];
  for (let i = 0; i < segs.rows; i++) {
    const [x1, y1, x2, y2] = segs.data32S.slice(i * 4, i * 4 + 4);
    raw.push(segmentLine(x1, y1, x2, y2));
  }
  raw.sort((a, b) => b.len - a.len);
  // Collapse duplicates (one physical edge yields many segments), but
  // tightly: a frame printed just inside a sleeve is a line of its own.
  const lines = [];
  for (const l of raw) {
    const same = lines.find(
      (m) => angleDiff(l.angle, m.angle) < 0.04 && lineSeparation(l, m) < minSide * 0.008,
    );
    if (same) same.evidence += l.len;
    else lines.push({ ...l, evidence: l.len });
  }
  return lines.sort((a, b) => b.evidence - a.evidence).slice(0, MAX_LINES);
}

/**
 * Where a line runs along an edge, as running hit counts across the whole
 * frame, so the coverage of any stretch of it costs one subtraction.
 */
function lineCoverage(line, grad) {
  const { width, height, threshold } = grad;
  const reach = Math.ceil(Math.hypot(width, height));
  const count = Math.ceil((reach * 2) / COVERAGE_STEP);
  const hits = new Int32Array(count + 1);
  const nx = -line.dy;
  const ny = line.dx;
  for (let k = 0; k < count; k++) {
    const t = -reach + k * COVERAGE_STEP;
    const x = line.px + line.dx * t;
    const y = line.py + line.dy * t;
    const inFrame = x >= 0 && y >= 0 && x < width && y < height;
    const hit = inFrame && edgeResponse(x, y, nx, ny, grad) > threshold;
    hits[k + 1] = hits[k] + (hit ? 1 : 0);
  }
  return { hits, reach, count };
}

/** Share of the line between points p and q (both on it) that lies on an edge. */
function spanCoverage(line, p, q) {
  const { hits, reach, count } = line.coverage;
  const position = (r) =>
    ((r.x - line.px) * line.dx + (r.y - line.py) * line.dy + reach) / COVERAGE_STEP;
  const a = position(p);
  const b = position(q);
  // Skip the ends, like sideEdge: corners are often rounded or worn.
  const from = clamp(Math.round(a + (b - a) * 0.1), 0, count);
  const to = clamp(Math.round(a + (b - a) * 0.9), 0, count);
  const samples = Math.abs(to - from);
  return samples === 0 ? 0 : Math.abs(hits[to] - hits[from]) / samples;
}

/** Tilted-square test for ordered corners; see the LINE_QUAD_ constants. */
function plausibleShape(q) {
  const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y));
  if (Math.max(...sides) > Math.min(...sides) * LINE_QUAD_MAX_SIDE_RATIO) return false;
  return q.every((p, i) => {
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const cos =
      ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) /
      (Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - p.x, b.y - p.y));
    const deg = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
    return deg >= LINE_QUAD_MIN_CORNER_DEG && deg <= LINE_QUAD_MAX_CORNER_DEG;
  });
}

/**
 * Candidates from straight lines: works when clutter (grain, cover art
 * touching the border, a busy shelf behind) breaks the outline into
 * pieces that never close into one contour. Lines are paired into roughly
 * parallel pairs, and two pairs at a clear angle form a quad. A busy room
 * makes thousands of those, so each is ranked by how much of its weakest
 * side lies on an edge (cheap, thanks to lineCoverage) and only the best
 * go on to full scoring.
 */
function quadsFromLines(edges, size, grad, track) {
  const minSide = Math.min(size.width, size.height);
  const lines = detectLines(edges, size, track);
  for (const line of lines) line.coverage = lineCoverage(line, grad);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (
        angleDiff(lines[i].angle, lines[j].angle) < 0.35 &&
        lineSeparation(lines[i], lines[j]) > minSide * 0.25
      ) {
        pairs.push([lines[i], lines[j]]);
      }
    }
  }
  const ranked = [];
  const margin = minSide * 0.03;
  const minArea = size.width * size.height * MIN_AREA_FRACTION;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i];
      const [b1, b2] = pairs[j];
      if (angleDiff(a1.angle, b1.angle) < 0.9) continue; // need ~perpendicular-ish
      const corners = [intersect(a1, b1), intersect(b1, a2), intersect(a2, b2), intersect(b2, a1)];
      if (corners.some((p) => !p)) continue;
      const inside = corners.every(
        (p) =>
          p.x > -margin && p.y > -margin && p.x < size.width + margin && p.y < size.height + margin,
      );
      if (!inside) continue;
      const coverage = Math.min(
        spanCoverage(b1, corners[0], corners[1]),
        spanCoverage(a2, corners[1], corners[2]),
        spanCoverage(b2, corners[2], corners[3]),
        spanCoverage(a1, corners[3], corners[0]),
      );
      if (coverage < MIN_LINE_SIDE_COVERAGE) continue;
      const ordered = orderClockwise(corners);
      const area = polygonArea(ordered);
      if (area < minArea || !plausibleShape(ordered)) continue;
      ranked.push({ ordered, rank: coverage ** 3 * area });
    }
  }
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_LINE_QUADS)
    .map((q) => q.ordered);
}

/**
 * Candidate sleeve outlines: { corners (unordered), support (0–1) },
 * strongest first; may be empty.
 */
function detectQuads(imageData) {
  return withMats((track) => {
    const src = track(cv.matFromImageData(imageData));
    const size = { width: imageData.width, height: imageData.height };
    const minArea = size.width * size.height * MIN_AREA_FRACTION;
    const { maps, lineEdges } = buildMaps(src, track);
    const quads = [];
    for (const map of maps) {
      const contours = track(new cv.MatVector());
      const hierarchy = track(new cv.Mat());
      // RETR_LIST, not EXTERNAL: when the outline merges with clutter, the
      // sleeve is often an inner contour of the merged blob.
      cv.findContours(map, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const big = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = track(contours.get(i));
        const area = cv.contourArea(c);
        if (area >= minArea) big.push({ c, area });
      }
      big.sort((a, b) => b.area - a.area);
      for (const { c } of big.slice(0, MAX_CONTOURS_PER_MAP)) {
        quads.push(...quadsFromContour(c, track));
      }
    }
    const grad = gradients(src, track);
    quads.push(...quadsFromLines(lineEdges, size, grad, track));

    return quads
      .map((corners) => ({ corners, support: edgeSupport(orderClockwise(corners), grad) }))
      .filter((c) => c.support > MIN_SUPPORT)
      .sort((a, b) => b.support - a.support)
      .slice(0, MAX_CANDIDATES);
  });
}

/*
 * Disc detection. HoughCircles alone proposes plenty of circles in a busy
 * room, and the biggest is usually a table edge running off the photo. So
 * it only proposes: each proposal is scored by how much of its rim really
 * lies on an edge, then the best is fitted onto that edge.
 */

/**
 * Longest edge discs are judged at. More detail doesn't help a rim that big
 * and only gives creases in a bedsheet a chance.
 */
const CIRCLE_WORK_EDGE = 560;
/** Longest edge the circle search runs at; the rim fit restores the precision. */
const CIRCLE_SEARCH_EDGE = 360;
/** Proposals scored per photo, and how many of the best get the (slower) rim fit. */
const MAX_CIRCLE_PROPOSALS = 30;
const MAX_CIRCLE_FITS = 4;
/** Rim fits per proposal: each can walk a further step onto the real rim. */
const RIM_FIT_ROUNDS = 2;
const RIM_SAMPLES = 72;
/** Least share of the rim on an edge for a circle to count as a record. */
const MIN_RIM_SUPPORT = 0.4;
/** How far a record may stick out of the photo, as a share of its radius. */
const MAX_RIM_OVERHANG = 0.04;
/** How far the rim fit looks either side of the circle, as a share of its radius. */
const RIM_SEARCH_FRACTION = 0.08;
/** Rim points further than this from the fitted circle are ignored, in pixels. */
const RIM_INLIER_DISTANCE = 2.5;

/** Whether `c` lies in the frame, give or take MAX_RIM_OVERHANG. */
function circleInFrame(c, width, height) {
  const slack = c.r * MAX_RIM_OVERHANG;
  return (
    c.cx - c.r >= -slack &&
    c.cy - c.r >= -slack &&
    c.cx + c.r <= width + slack &&
    c.cy + c.r <= height + slack
  );
}

/** Share of the circle's rim that lies on an edge running along it. */
function rimSupport(c, grad) {
  let hits = 0;
  for (let k = 0; k < RIM_SAMPLES; k++) {
    const a = (k * 2 * Math.PI) / RIM_SAMPLES;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    if (edgeResponse(c.cx + nx * c.r, c.cy + ny * c.r, nx, ny, grad) > grad.threshold) hits++;
  }
  return hits / RIM_SAMPLES;
}

/** Least-squares circle through the points (Kåsa), or null if they're degenerate. */
function fitCircle(points) {
  const mx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const my = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-6) return null;
  const rhsU = (suuu + suvv) / 2;
  const rhsV = (svvv + svuu) / 2;
  const uc = (rhsU * svv - rhsV * suv) / det;
  const vc = (rhsV * suu - rhsU * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / points.length);
  return { cx: mx + uc, cy: my + vc, r };
}

/** Moves a circle onto the strongest edge near its rim, ignoring stray points. */
function fitRim(circle, grad) {
  const band = Math.ceil(circle.r * RIM_SEARCH_FRACTION);
  const points = [];
  for (let k = 0; k < RIM_SAMPLES; k++) {
    const a = (k * 2 * Math.PI) / RIM_SAMPLES;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    let best = grad.threshold;
    let found = null;
    for (let o = -band; o <= band; o++) {
      const x = circle.cx + nx * (circle.r + o);
      const y = circle.cy + ny * (circle.r + o);
      const g = edgeResponse(x, y, nx, ny, grad);
      if (g > best) {
        best = g;
        found = { x, y };
      }
    }
    if (found) points.push(found);
  }
  let kept = points;
  let fitted = circle;
  for (let pass = 0; pass < 3 && kept.length >= 6; pass++) {
    const next = fitCircle(kept);
    if (!next) return circle;
    fitted = next;
    kept = points.filter(
      (p) =>
        Math.abs(Math.hypot(p.x - fitted.cx, p.y - fitted.cy) - fitted.r) <= RIM_INLIER_DISTANCE,
    );
  }
  return fitted;
}

/** The record's circle, or null if nothing has enough of a rim. */
function detectCircle(imageData) {
  return withMats((track) => {
    const full = track(cv.matFromImageData(imageData));
    const down = Math.min(1, CIRCLE_WORK_EDGE / Math.max(full.cols, full.rows));
    const src = track(new cv.Mat());
    cv.resize(full, src, new cv.Size(0, 0), down, down, cv.INTER_AREA);
    const width = src.cols;
    const height = src.rows;
    const scale = Math.min(1, CIRCLE_SEARCH_EDGE / Math.max(width, height));
    const gray = track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const small = track(new cv.Mat());
    cv.resize(gray, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    cv.medianBlur(small, small, 5);
    const minSide = Math.min(small.cols, small.rows);
    const proposals = track(new cv.Mat());
    cv.HoughCircles(
      small,
      proposals,
      cv.HOUGH_GRADIENT,
      1,
      minSide * 0.05,
      60,
      25,
      Math.round(minSide * 0.2),
      Math.round(minSide * 0.55),
    );
    const grad = gradients(src, track);
    const count = Math.min(proposals.cols, MAX_CIRCLE_PROPOSALS);
    const ranked = [];
    for (let i = 0; i < count; i++) {
      const circle = {
        cx: proposals.data32F[i * 3] / scale,
        cy: proposals.data32F[i * 3 + 1] / scale,
        r: proposals.data32F[i * 3 + 2] / scale,
      };
      ranked.push({ circle, support: rimSupport(circle, grad) });
    }
    ranked.sort((a, b) => b.support - a.support);
    let best = null;
    let bestScore = 0;
    for (const { circle } of ranked.slice(0, MAX_CIRCLE_FITS)) {
      let fitted = circle;
      for (let round = 0; round < RIM_FIT_ROUNDS; round++) fitted = fitRim(fitted, grad);
      if (!circleInFrame(fitted, width, height)) continue;
      const support = rimSupport(fitted, grad);
      if (support < MIN_RIM_SUPPORT) continue;
      const score = (support * fitted.r) ** 2;
      if (score > bestScore) {
        best = fitted;
        bestScore = score;
      }
    }
    return best && { cx: best.cx / down, cy: best.cy / down, r: best.r / down };
  });
}

/** Perspective-warps `quad` (TL, TR, BR, BL) to a size×size square. */
function warp(imageData, quad, size) {
  return withMats((track) => {
    const src = track(cv.matFromImageData(imageData));
    const from = track(
      cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        quad.flatMap((p) => [p.x, p.y]),
      ),
    );
    const to = track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size, 0, size, size, 0, size]));
    const m = track(cv.getPerspectiveTransform(from, to));
    const out = track(new cv.Mat());
    cv.warpPerspective(
      src,
      out,
      m,
      new cv.Size(size, size),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );
    return new ImageData(new Uint8ClampedArray(out.data), size, size);
  });
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    await loadOpenCv();
    let result;
    if (type === 'init') result = true;
    else if (type === 'detectQuads') result = detectQuads(event.data.image);
    else if (type === 'detectCircle') result = detectCircle(event.data.image);
    else if (type === 'warp') result = warp(event.data.image, event.data.quad, event.data.size);
    else throw new Error(`Unknown request type: ${type}`);
    const transfer = result instanceof ImageData ? [result.data.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
