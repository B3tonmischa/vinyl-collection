// Pure geometry for camera capture / auto-crop, kept free of DOM and
// OpenCV so it can be unit-tested in jsdom. Coordinates are always in the
// pixel space of whichever image they were measured on; scalePoints /
// scaleCircle convert between the downscaled detection copy, the working
// image and the on-screen preview.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Corners in TL, TR, BR, BL order once passed through orderCorners(). */
export type Quad = [Point, Point, Point, Point];

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Longest edge of the image the crop is computed on (memory cap for iOS). */
export const WORKING_MAX_EDGE = 3000;
/** Longest edge sent to OpenCV for detection — corners get scaled back up. */
export const DETECT_MAX_EDGE = 800;
/** Smaller for the live viewfinder: nearly as accurate, about twice as fast. */
export const LIVE_DETECT_MAX_EDGE = 560;
/** Matches the backend's FULL_MAX_DIMENSION — anything bigger is thrown away. */
export const OUTPUT_MAX_EDGE = 2000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/**
 * Orders four arbitrary corners as TL, TR, BR, BL: sorted clockwise by
 * angle around their centroid (y points down, so ascending atan2 is
 * clockwise), then rotated so the corner with the smallest x+y leads.
 * Unlike the classic sum/difference trick this never picks the same
 * point twice, even for a sleeve shot at ~45°.
 */
export function orderCorners(points: Point[]): Quad {
  if (points.length !== 4) throw new Error(`Expected 4 corners, got ${points.length}`);
  const c = centroid(points);
  const clockwise = [...points].sort(
    (a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x),
  );
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (clockwise[i].x + clockwise[i].y < clockwise[start].x + clockwise[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => clockwise[(start + i) % 4]) as Quad;
}

/** Scale factor that fits `size` within `maxEdge` without enlarging. */
export function fitScale(size: Size, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(size.width, size.height));
}

export function fitSize(size: Size, maxEdge: number): Size {
  const s = fitScale(size, maxEdge);
  return { width: Math.round(size.width * s), height: Math.round(size.height * s) };
}

export function scalePoints<T extends Point[]>(points: T, from: Size, to: Size): T {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return points.map((p) => ({ x: p.x * sx, y: p.y * sy })) as T;
}

export function scaleCircle(circle: Circle, from: Size, to: Size): Circle {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { cx: circle.cx * sx, cy: circle.cy * sy, r: circle.r * Math.min(sx, sy) };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shoelace area; order-independent sign. */
export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function sideMidpoints(quad: Quad): Point[] {
  return quad.map((p, i) => {
    const q = quad[(i + 1) % 4];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
}

function sides(quad: Quad): number[] {
  return quad.map((p, i) => distance(p, quad[(i + 1) % 4]));
}

/** Interior angle at each corner, in degrees. */
function cornerAngles(quad: Quad): number[] {
  return quad.map((p, i) => {
    const prev = quad[(i + 3) % 4];
    const next = quad[(i + 1) % 4];
    const a = Math.atan2(prev.y - p.y, prev.x - p.x);
    const b = Math.atan2(next.y - p.y, next.x - p.x);
    const deg = Math.abs(((b - a) * 180) / Math.PI) % 360;
    return deg > 180 ? 360 - deg : deg;
  });
}

// What a sleeve shot on purpose can look like (see isPlausibleSleeveQuad).
const SLEEVE_MIN_AREA_FRACTION = 0.08;
const SLEEVE_MAX_AREA_FRACTION = 0.95;
const SLEEVE_MAX_SIDE_RATIO = 1.6;
const SLEEVE_MIN_CORNER_DEG = 55;
const SLEEVE_MAX_CORNER_DEG = 125;
/** Share of the longer image edge that counts as "on the border". */
const BORDER_MARGIN_FRACTION = 0.012;

/**
 * Rejects detections that can't be a sleeve shot on purpose: too small a
 * share of the frame (a label or a sticker), basically the whole frame
 * (the photo's own border), too far from square even allowing for camera
 * tilt, or corners too sharp/blunt to be a tilted square. Expects ordered
 * corners.
 */
export function isPlausibleSleeveQuad(quad: Quad, frame: Size): boolean {
  const areaFraction = quadArea(quad) / (frame.width * frame.height);
  if (areaFraction < SLEEVE_MIN_AREA_FRACTION || areaFraction > SLEEVE_MAX_AREA_FRACTION) {
    return false;
  }
  const s = sides(quad);
  if (Math.max(...s) / Math.min(...s) > SLEEVE_MAX_SIDE_RATIO) return false;
  const badCorner = (deg: number) => deg < SLEEVE_MIN_CORNER_DEG || deg > SLEEVE_MAX_CORNER_DEG;
  if (cornerAngles(quad).some(badCorner)) return false;
  // A whole side on the image border: the photo's own edge (or floorboards
  // / a table edge running off it), not a sleeve lying in view.
  const m = Math.max(frame.width, frame.height) * BORDER_MARGIN_FRACTION;
  const nearLeft = (p: Point) => p.x < m;
  const nearTop = (p: Point) => p.y < m;
  const nearRight = (p: Point) => p.x > frame.width - m;
  const nearBottom = (p: Point) => p.y > frame.height - m;
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4];
    return ![nearLeft, nearTop, nearRight, nearBottom].some((near) => near(a) && near(b));
  });
}

/** Scales a quad about its centroid (1.03 = 3% bigger). */
export function expandQuad(quad: Quad, factor: number): Quad {
  const c = centroid(quad);
  return quad.map((p) => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor,
  })) as Quad;
}

/** True when p lies inside a convex, ordered quad (or on its edge). */
export function pointInQuad(p: Point, quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** One outline proposed by the detector (scan-worker.js). */
export interface QuadCandidate {
  /** Corners in any order. */
  corners: Point[];
  /** 0–1: share of the weakest side that runs along a real image edge. */
  support: number;
}

/** A detector candidate once its corners are ordered. */
interface SleeveCandidate {
  quad: Quad;
  support: number;
}

/** Corners closer than this share of the frame diagonal count as the same outline. */
const AGREE_TOLERANCE_FRACTION = 0.03;
/** Score boost per agreeing candidate, capped at MAX_AGREEING_PEERS. */
const AGREEMENT_BONUS = 0.25;
const MAX_AGREEING_PEERS = 4;
// An enclosing outline replaces the winner (see enclosingSleeve) only if
// it is well supported, somewhat but not much bigger, and differs on
// every side.
const ENCLOSING_MIN_SUPPORT = 0.55;
const ENCLOSING_MIN_AREA_RATIO = 1.05;
const ENCLOSING_MAX_AREA_RATIO = 1.7;
const ENCLOSING_SLACK = 1.03;
const ENCLOSING_MIN_SIDE_GAP = 1 / 3; // of the agree tolerance

/** Edge support dominates both the score and the corner average. */
function supportWeight(support: number): number {
  return support ** 3;
}

/**
 * Chooses the sleeve among the detector's candidates (contours from
 * several edge/region maps plus straight-line combinations). Edge support
 * dominates — a real sleeve has a crisp edge on all four sides, while
 * shadows and texture blobs don't — and candidates that several methods
 * agree on get a boost. Among the rest, bigger, squarer and more central
 * (the user aims at the guide) wins. The result is the mean of the
 * agreeing candidates, which also steadies the live outline.
 */
export function pickSleeveQuad(candidates: QuadCandidate[], frame: Size): Quad | null {
  const plausible: SleeveCandidate[] = candidates
    .filter((c) => c.corners.length === 4)
    .map((c) => ({ quad: orderCorners(c.corners), support: c.support }))
    .filter((c) => isPlausibleSleeveQuad(c.quad, frame));
  if (plausible.length === 0) return null;

  const tolerance = Math.hypot(frame.width, frame.height) * AGREE_TOLERANCE_FRACTION;
  const clusterOf = (quad: Quad) =>
    plausible.filter((c) => quad.every((p, i) => distance(p, c.quad[i]) < tolerance));

  const winner = bestScoring(plausible, frame, clusterOf);
  const sleeve = enclosingSleeve(winner, plausible, tolerance) ?? winner;
  return weightedMean(clusterOf(sleeve));
}

function bestScoring(
  candidates: SleeveCandidate[],
  frame: Size,
  clusterOf: (quad: Quad) => SleeveCandidate[],
): Quad {
  const diag = Math.hypot(frame.width, frame.height);
  const center = { x: frame.width / 2, y: frame.height / 2 };
  const score = ({ quad, support }: SleeveCandidate) => {
    const s = sides(quad);
    const squareness = Math.min(...s) / Math.max(...s);
    const centrality = 1 - distance(centroid(quad), center) / diag;
    const areaFraction = quadArea(quad) / (frame.width * frame.height);
    const peers = Math.min(clusterOf(quad).length - 1, MAX_AGREEING_PEERS);
    const agreement = 1 + AGREEMENT_BONUS * peers;
    return supportWeight(support) * agreement * areaFraction * squareness * centrality;
  };
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best.quad;
}

/**
 * Many covers print a frame or border inside the sleeve, which has a
 * perfect edge and wins on score. If a well-supported candidate surrounds
 * the winner on all four sides (give or take a few pixels) and isn't much
 * bigger, that's the real sleeve. All four matters: an outline sharing
 * three sides with the winner and pushing the fourth out to a grain line
 * or table edge is the sleeve plus clutter.
 */
function enclosingSleeve(
  winner: Quad,
  candidates: SleeveCandidate[],
  tolerance: number,
): Quad | null {
  const winnerArea = quadArea(winner);
  const winnerMids = sideMidpoints(winner);
  const encloses = ({ quad, support }: SleeveCandidate) => {
    const area = quadArea(quad);
    const slack = expandQuad(quad, ENCLOSING_SLACK);
    return (
      support >= ENCLOSING_MIN_SUPPORT &&
      area > winnerArea * ENCLOSING_MIN_AREA_RATIO &&
      area < winnerArea * ENCLOSING_MAX_AREA_RATIO &&
      winner.every((p) => pointInQuad(p, slack)) &&
      sideMidpoints(quad).every(
        (m, i) => distance(m, winnerMids[i]) > tolerance * ENCLOSING_MIN_SIDE_GAP,
      )
    );
  };
  const [best] = candidates
    .filter(encloses)
    .sort((a, b) => b.support - a.support || quadArea(b.quad) - quadArea(a.quad));
  return best?.quad ?? null;
}

/** Support-weighted corner mean, so a sloppy near-duplicate barely shifts the corners. */
function weightedMean(cluster: SleeveCandidate[]): Quad {
  const total = cluster.reduce((sum, c) => sum + supportWeight(c.support), 0);
  const mean = (i: number, axis: 'x' | 'y') =>
    cluster.reduce((sum, c) => sum + c.quad[i][axis] * supportWeight(c.support), 0) / total;
  return [0, 1, 2, 3].map((i) => ({ x: mean(i, 'x'), y: mean(i, 'y') })) as Quad;
}

/** Edge length of the square a sleeve quad gets warped to. */
export function squareOutputSize(quad: Quad, maxEdge = OUTPUT_MAX_EDGE): number {
  const mean = sides(quad).reduce((a, b) => a + b, 0) / 4;
  return Math.max(1, Math.round(Math.min(maxEdge, mean)));
}

/** The square guide shown in the viewfinder — also the no-detection fallback crop. */
export function guideFrameQuad(frame: Size, fraction = 0.8): Quad {
  const side = Math.min(frame.width, frame.height) * fraction;
  const left = (frame.width - side) / 2;
  const top = (frame.height - side) / 2;
  return [
    { x: left, y: top },
    { x: left + side, y: top },
    { x: left + side, y: top + side },
    { x: left, y: top + side },
  ];
}

/** The circle guide shown for disc shots — also the no-detection fallback. */
export function guideCircle(frame: Size, fraction = 0.42): Circle {
  return {
    cx: frame.width / 2,
    cy: frame.height / 2,
    r: Math.min(frame.width, frame.height) * fraction,
  };
}

export function clampPoint(p: Point, frame: Size): Point {
  return { x: clamp(p.x, 0, frame.width), y: clamp(p.y, 0, frame.height) };
}

/** Keeps a disc circle fully inside the frame and at a usable minimum size. */
export function clampCircle(circle: Circle, frame: Size, minRadius = 20): Circle {
  const maxRadius = Math.min(frame.width, frame.height) / 2;
  const r = clamp(circle.r, Math.min(minRadius, maxRadius), maxRadius);
  return {
    cx: clamp(circle.cx, r, frame.width - r),
    cy: clamp(circle.cy, r, frame.height - r),
    r,
  };
}

/** Square output edge for a disc crop. */
export function discOutputSize(circle: Circle, maxEdge = OUTPUT_MAX_EDGE): number {
  return Math.max(1, Math.round(Math.min(maxEdge, circle.r * 2)));
}

export interface Rect extends Point, Size {}

/** Axis-aligned bounds of a quad, used when OpenCV isn't available to warp. */
export function quadBounds(quad: Quad, frame: Size): Rect {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  return {
    x,
    y,
    width: Math.min(frame.width, Math.max(...xs)) - x,
    height: Math.min(frame.height, Math.max(...ys)) - y,
  };
}

// SVG helpers for the crop overlays.

/** `points` attribute of an SVG polygon. */
export function quadPoints(quad: Quad): string {
  return quad.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Whole frame minus the quad (evenodd), to dim what gets cut away. */
export function quadMaskPath(quad: Quad, frame: Size): string {
  const [a, b, c, d] = quad;
  return (
    `M0 0H${frame.width}V${frame.height}H0Z ` +
    `M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}L${d.x} ${d.y}Z`
  );
}

/** Whole frame minus the circle (evenodd). */
export function circleMaskPath(c: Circle, frame: Size): string {
  return (
    `M0 0H${frame.width}V${frame.height}H0Z M${c.cx - c.r} ${c.cy}` +
    `a${c.r} ${c.r} 0 1 0 ${c.r * 2} 0a${c.r} ${c.r} 0 1 0 ${-c.r * 2} 0Z`
  );
}
