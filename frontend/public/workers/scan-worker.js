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
const MAX_CANDIDATES = 40;
/** Candidates whose weakest side has less edge support are dropped. */
const MIN_SUPPORT = 0.25;

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
  cv.bitwise_or(lineEdges, color, lineEdges);
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
  return { width: src.cols, height: src.rows, channels: out, threshold: edgeThreshold(out) };
}

/**
 * What counts as "a real edge". A clean sleeve edge after the 5×5 blur
 * gives a Sobel response in the hundreds, but a white sleeve on a light
 * table only ~30–50. So the threshold follows the photo: a few times the
 * median gradient (≈ its texture/noise level), clamped to [18, 60].
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
  return clamp(median * 3, 18, 60);
}

/**
 * Edge evidence along the stretch t0…t1 of side a→b (0 = a, 1 = b;
 * outside 0–1 is the side's extension past its corners): `hits`, the
 * share that runs along an edge across it, and `strength`, the mean edge
 * response there. An edge counts in any color channel, within ±2 px. Only the
 * gradient component normal to the side counts, so grain lines crossing
 * a side don't. The ends are skipped: corners are often rounded, worn or
 * occluded.
 */
function sideEdge(a, b, grad, t0, t1) {
  const { width, height, channels, threshold } = grad;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const samples = 32;
  let hits = 0;
  let total = 0;
  for (let k = 0; k < samples; k++) {
    const t = t0 + ((t1 - t0) * (k + 0.5)) / samples;
    const sx = a.x + (b.x - a.x) * t;
    const sy = a.y + (b.y - a.y) * t;
    let best = 0;
    for (let o = -2; o <= 2; o++) {
      const x = Math.round(sx + nx * o);
      const y = Math.round(sy + ny * o);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = y * width + x;
      for (const c of channels) {
        const g = Math.abs(c.gx[idx] * nx + c.gy[idx] * ny);
        if (g > best) best = g;
      }
    }
    if (best > threshold) hits++;
    total += Math.min(best, threshold * 6); // one hot pixel shouldn't dominate
  }
  return { hits: hits / samples, strength: total / samples };
}

/**
 * How much the edge past a corner looks like the *same* edge carrying on:
 * its hits, counted only when it's about as strong as the side itself. A
 * sleeve edge lying along a fainter grain line doesn't continue; a grain
 * line, or a sleeve edge running past a fake corner, does.
 */
function continuation(side, extension) {
  if (side.strength <= 0) return 0;
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
 * art crossing the extension at a shallow angle.)
 */
function edgeSupport(quad, grad) {
  let weakest = 1;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 10) return 0;
    const on = sideEdge(a, b, grad, 0.1, 0.9);
    const overshoot = Math.max(
      continuation(on, sideEdge(a, b, grad, -0.3, -0.04)),
      continuation(on, sideEdge(a, b, grad, 1.04, 1.3)),
    );
    const penalty = 0.8 * clamp((overshoot - 0.35) / 0.65, 0, 1);
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
 * Candidates from straight lines: works when clutter (grain, cover art
 * touching the border) breaks the outline into pieces that never close
 * into one contour. Long segments are merged into lines, paired into
 * roughly parallel pairs, and two pairs at a clear angle form a quad.
 */
function quadsFromLines(edges, size, track) {
  const minSide = Math.min(size.width, size.height);
  const segs = track(new cv.Mat());
  cv.HoughLinesP(edges, segs, 1, Math.PI / 180, 50, minSide * 0.2, 15);
  const raw = [];
  for (let i = 0; i < segs.rows; i++) {
    const [x1, y1, x2, y2] = segs.data32S.slice(i * 4, i * 4 + 4);
    raw.push(segmentLine(x1, y1, x2, y2));
  }
  raw.sort((a, b) => b.len - a.len);
  // Collapse duplicates (one physical edge yields many segments).
  const lines = [];
  for (const l of raw) {
    const dup = lines.some(
      (m) => angleDiff(l.angle, m.angle) < 0.06 && lineSeparation(l, m) < minSide * 0.02,
    );
    if (!dup) lines.push(l);
    if (lines.length >= 20) break;
  }
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
  const quads = [];
  const margin = minSide * 0.03;
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
      const ordered = orderClockwise(corners);
      if (polygonArea(ordered) >= size.width * size.height * MIN_AREA_FRACTION) quads.push(ordered);
    }
  }
  return quads;
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
    quads.push(...quadsFromLines(lineEdges, size, track));

    const grad = gradients(src, track);
    return quads
      .map((corners) => ({ corners, support: edgeSupport(orderClockwise(corners), grad) }))
      .filter((c) => c.support > MIN_SUPPORT)
      .sort((a, b) => b.support - a.support)
      .slice(0, MAX_CANDIDATES);
  });
}

/** Biggest plausible record-sized circle, or null. Best effort. */
function detectCircle(imageData) {
  return withMats((track) => {
    const src = track(cv.matFromImageData(imageData));
    const gray = track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.medianBlur(gray, gray, 5);
    const minSide = Math.min(imageData.width, imageData.height);
    const circles = track(new cv.Mat());
    cv.HoughCircles(
      gray,
      circles,
      cv.HOUGH_GRADIENT,
      1.5,
      minSide / 2,
      120,
      50,
      Math.round(minSide * 0.25),
      Math.round(minSide * 0.6),
    );
    let best = null;
    for (let i = 0; i < circles.cols; i++) {
      const [cx, cy, r] = [
        circles.data32F[i * 3],
        circles.data32F[i * 3 + 1],
        circles.data32F[i * 3 + 2],
      ];
      if (!best || r > best.r) best = { cx, cy, r };
    }
    return best;
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
