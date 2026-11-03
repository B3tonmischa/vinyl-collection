// Snaps a detected sleeve outline onto the sleeve's real edges at full
// working resolution. Detection runs on an 800 px copy whose edge maps
// are blurred and morphologically closed, so its outline lands a few
// pixels off the sleeve (mostly outside) — and on a table, on the outer
// rim of the sleeve's shadow. Left alone, that leaves a strip of
// background along the cropped cover, or cuts into it. Kept free of DOM
// and OpenCV so it runs in jsdom.

import { Point, Quad, centroid } from './camera-capture.logic';

/** RGBA pixels, like ImageData. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Line {
  /** A point on the line. */
  px: number;
  py: number;
  /** Unit direction. */
  dx: number;
  dy: number;
}

/**
 * How far a side may move, in detection-image pixels. Detection was off
 * by up to ~5 px on test photos; much wider and cover art printed near
 * the edge comes into reach.
 */
export const REFINE_BAND_DETECTION_PX = 8;

/** Profiles taken along each side, over its middle (corners are often worn). */
const SAMPLES_PER_SIDE = 48;
const SIDE_MARGIN = 0.15;
/** Profiles are averaged this far either side along the edge, to calm texture. */
const TANGENT_HALF_WIDTH = 3;
/** Weakest color change (0–255 per pixel) that counts as an edge. */
const MIN_EDGE_STEP = 6;
/**
 * An edge's contrast is the color difference between the flat stretches
 * either side of it (PLATEAU_GAP…PLATEAU_GAP + PLATEAU_WIDTH px away).
 * A thin printed frame line has the same color on both sides, so it has
 * a sharp gradient but no contrast; the sleeve's edge has plenty.
 */
const PLATEAU_GAP = 3;
const PLATEAU_WIDTH = 6;
const MIN_CONTRAST = 12;
/**
 * The edge with the most contrast is usually sleeve against background.
 * On a table, though, it can be the outer rim of the sleeve's shadow, so
 * when the stretch just inside it looks like shadow — the background,
 * somewhat darker and about the same hue — the next clear edge further
 * in (at most SHADOW_MAX_WIDTH px) wins instead.
 */
const SHADOW_MAX_WIDTH = 24;
/**
 * Brightness range of a shadow relative to the background. A sleeve's
 * shadow keeps roughly half the light; a black sleeve on a white sheet
 * is down near a fifth, so it isn't mistaken for one.
 */
const SHADOW_MIN_BRIGHTNESS = 0.3;
const SHADOW_MAX_BRIGHTNESS = 0.9;
/**
 * Most one channel may darken more than another. Shadows shift the hue a
 * little (on a warm wooden table, blue drops further than red), but a
 * colored print next to the edge shifts it a lot.
 */
const SHADOW_MAX_HUE_SHIFT = 2;
/** Least share of a side's profiles that must agree on one straight edge. */
const MIN_INLIER_SHARE = 0.5;

/**
 * Moves each side of `quad` (TL, TR, BR, BL, in `image` pixels) onto the
 * sleeve's edge within `band` pixels of it. A side keeps its old position
 * when its profiles don't agree on a straight edge or the fit would move
 * an end further than `band` — so a sleeve that barely stands out from
 * the table (white on white) is never made worse.
 */
export function refineSleeveQuad(image: Pixels, quad: Quad, band: number): Quad {
  const center = centroid(quad);
  const lines = quad.map((a, i) => refineSide(image, a, quad[(i + 1) % 4], center, band));
  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    // Neighbouring sides each moved at most `band`, so a corner can't
    // move much further unless the lines are nearly parallel.
    if (!p || Math.hypot(p.x - quad[i].x, p.y - quad[i].y) > band * 3) return quad;
    refined.push(p);
  }
  return refined as Quad;
}

function refineSide(image: Pixels, a: Point, b: Point, center: Point, band: number): Line {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const original = { px: a.x, py: a.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
  const reach = Math.floor(band);
  if (len < 1 || reach < 2) return original;
  const { dx, dy } = original;
  // Outward normal: away from the quad's centroid.
  let nx = -dy;
  let ny = dx;
  if (((a.x + b.x) / 2 - center.x) * nx + ((a.y + b.y) / 2 - center.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  const points: Point[] = [];
  for (let k = 0; k < SAMPLES_PER_SIDE; k++) {
    const t = SIDE_MARGIN + ((1 - 2 * SIDE_MARGIN) * (k + 0.5)) / SAMPLES_PER_SIDE;
    const sx = a.x + (b.x - a.x) * t;
    const sy = a.y + (b.y - a.y) * t;
    const offset = edgeOffset(image, sx, sy, dx, dy, nx, ny, reach);
    if (offset !== null) points.push({ x: sx + nx * offset, y: sy + ny * offset });
  }
  if (points.length < SAMPLES_PER_SIDE * MIN_INLIER_SHARE) return original;

  const fit = robustLine(points);
  if (!fit || fit.inliers < SAMPLES_PER_SIDE * MIN_INLIER_SHARE) return original;
  // Both ends must stay within the band. A side that tilts further has
  // mixed two edges (the sleeve's and its shadow's), or found art.
  const { line } = fit;
  const moved = (p: Point) => Math.abs((p.x - line.px) * line.dy - (p.y - line.py) * line.dx);
  if (moved(a) > reach || moved(b) > reach) return original;
  return line;
}

/**
 * Offset along the outward normal (in −reach…reach) of the sleeve's edge
 * where it crosses the side at (sx, sy), or null if there's none.
 * The profile runs a plateau's width past the band so edges near its
 * ends still get a contrast.
 */
function edgeOffset(
  image: Pixels,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  nx: number,
  ny: number,
  reach: number,
): number | null {
  // Mean color at each offset, averaged along the edge.
  const pad = PLATEAU_GAP + PLATEAU_WIDTH;
  const start = -reach - pad;
  const n = (reach + pad) * 2 + 1;
  const profile = new Float32Array(n * 3);
  for (let o = start; o <= reach + pad; o++) {
    let r = 0;
    let g = 0;
    let bl = 0;
    let count = 0;
    for (let s = -TANGENT_HALF_WIDTH; s <= TANGENT_HALF_WIDTH; s++) {
      const x = sx + nx * o + dx * s;
      const y = sy + ny * o + dy * s;
      const i = pixelIndex(image, x, y);
      if (i < 0) continue;
      r += image.data[i];
      g += image.data[i + 1];
      bl += image.data[i + 2];
      count++;
    }
    if (count === 0) return null; // the band runs off the photo
    const j = (o - start) * 3;
    profile[j] = r / count;
    profile[j + 1] = g / count;
    profile[j + 2] = bl / count;
  }

  // Gradient at each offset, the largest of the three channels (a red
  // sleeve on a grey table of the same brightness still has an edge).
  const step = new Float32Array(n);
  for (let k = 1; k < n - 1; k++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      m = Math.max(m, Math.abs(profile[(k + 1) * 3 + c] - profile[(k - 1) * 3 + c]) / 2);
    }
    step[k] = m;
  }

  // Gradient peaks inside the band (inside → out), each with its contrast.
  const peaks: { k: number; contrast: number }[] = [];
  for (let k = pad; k < n - pad; k++) {
    if (step[k] < MIN_EDGE_STEP || step[k] < step[k - 1] || step[k] < step[k + 1]) continue;
    const contrast = plateauContrast(profile, k);
    if (contrast >= MIN_CONTRAST) peaks.push({ k, contrast });
  }
  if (peaks.length === 0) return null;
  const strongest = peaks.reduce((a, b) => (b.contrast > a.contrast ? b : a));
  let edge = strongest;
  if (isShadowOf(plateau(profile, strongest.k, -1), plateau(profile, strongest.k, 1))) {
    // The nearest clear edge inside the shadow (peaks run inside → out).
    for (const p of peaks) {
      if (p.k < strongest.k - PLATEAU_GAP && strongest.k - p.k <= SHADOW_MAX_WIDTH) edge = p;
    }
  }
  const { k } = edge;
  return k + start + subPixel(step[k - 1], step[k], step[k + 1]);
}

/** Mean color of the flat stretch inside (side −1) or outside (+1) offset k. */
function plateau(profile: Float32Array, k: number, side: -1 | 1): number[] {
  return [0, 1, 2].map((c) => {
    let sum = 0;
    for (let d = PLATEAU_GAP; d < PLATEAU_GAP + PLATEAU_WIDTH; d++) {
      sum += profile[(k + side * d) * 3 + c];
    }
    return sum / PLATEAU_WIDTH;
  });
}

/** Largest per-channel difference between the colors either side of offset k. */
function plateauContrast(profile: Float32Array, k: number): number {
  const inside = plateau(profile, k, -1);
  const outside = plateau(profile, k, 1);
  return Math.max(...inside.map((v, c) => Math.abs(outside[c] - v)));
}

/** Whether `color` looks like `background` in shadow. */
function isShadowOf(color: number[], background: number[]): boolean {
  const sum = (rgb: number[]) => rgb[0] + rgb[1] + rgb[2];
  const brightness = sum(color) / Math.max(1, sum(background));
  const factors = color.map((v, c) => v / Math.max(1, background[c]));
  return (
    brightness >= SHADOW_MIN_BRIGHTNESS &&
    brightness <= SHADOW_MAX_BRIGHTNESS &&
    Math.max(...factors) <= Math.min(...factors) * SHADOW_MAX_HUE_SHIFT
  );
}

/** Vertex of the parabola through three neighbouring values, in −0.5…0.5. */
function subPixel(left: number, mid: number, right: number): number {
  const denom = left - 2 * mid + right;
  return denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denom)));
}

/** Nearest pixel's index into `data`, or −1 off the image. */
function pixelIndex(image: Pixels, x: number, y: number): number {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return -1;
  return (iy * image.width + ix) * 4;
}

/** Points further than this from the line don't count towards its fit. */
const INLIER_DISTANCE = 2;

/**
 * Line through most of the points, ignoring outliers (profiles that hit
 * cover art or a crease instead of the edge). A deterministic RANSAC:
 * of the lines through pairs of points well apart, take the one most
 * points lie near, then least-squares fit to those points.
 */
function robustLine(points: Point[]): { line: Line; inliers: number } | null {
  const near = (line: Line) =>
    points.filter(
      (p) => Math.abs((p.x - line.px) * line.dy - (p.y - line.py) * line.dx) <= INLIER_DISTANCE,
    );
  const minGap = Math.max(1, Math.floor(points.length / 3));
  let best: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + minGap; j < points.length; j++) {
      const p = points[i];
      const q = points[j];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len === 0) continue;
      const kept = near({ px: p.x, py: p.y, dx: (q.x - p.x) / len, dy: (q.y - p.y) / len });
      if (kept.length > best.length) best = kept;
    }
  }
  if (best.length < 2) return null;
  let line = fitLine(best);
  for (let pass = 0; pass < 2; pass++) {
    const kept = near(line);
    if (kept.length < 2) return null;
    line = fitLine(kept);
  }
  return { line, inliers: near(line).length };
}

/** Total least squares: the line through the points' mean along their main axis. */
function fitLine(points: Point[]): Line {
  const { x: mx, y: my } = centroid(points);
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

function intersect(a: Line, b: Line): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}
