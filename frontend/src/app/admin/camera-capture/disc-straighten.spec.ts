import { describe, expect, it } from 'vitest';
import { Circle, Point } from './camera-capture.logic';
import {
  Mat3,
  STRAIGHT_MARGIN,
  apply,
  centreOfConcentric,
  circleConic,
  ellipseOf,
  fitConic,
  invert,
  mapConic,
  multiply,
  planStraightening,
  straightening,
  warpImage,
} from './disc-straighten';

/**
 * A camera looking at a record from an angle, close up: a pure rotation of
 * the camera, x' = K R K⁻¹ x, which is what tilting a phone over a table does.
 * The record lies at `record` in the head-on view.
 */
function tiltedCamera(
  tiltDeg: number,
  turnDeg: number,
  focal = 900,
  centre = { x: 600, y: 800 },
): Mat3 {
  const t = (tiltDeg * Math.PI) / 180;
  const u = (turnDeg * Math.PI) / 180;
  const k: Mat3 = [focal, 0, centre.x, 0, focal, centre.y, 0, 0, 1];
  const kInverse = invert(k)!;
  // Tilt about an axis in the image plane, at angle `turn` to x.
  const [ax, ay] = [Math.cos(u), Math.sin(u)];
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const r: Mat3 = [
    c + ax * ax * (1 - c),
    ax * ay * (1 - c),
    ay * s,
    ax * ay * (1 - c),
    c + ay * ay * (1 - c),
    -ax * s,
    -ay * s,
    ax * s,
    c,
  ];
  return multiply(k, multiply(r, kInverse));
}

function onCircle({ cx, cy, r }: Circle, count = 144): Point[] {
  return Array.from({ length: count }, (_, k) => {
    const a = (2 * Math.PI * k) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const record: Circle = { cx: 620, cy: 780, r: 450 };
const label: Circle = { ...record, r: 150 };

describe('fitConic', () => {
  it('recovers an ellipse from points on it', () => {
    const camera = tiltedCamera(28, 20);
    const conic = fitConic(onCircle(record).map((p) => apply(camera, p)))!;
    const expected = ellipseOf(mapConic(circleConic(record), camera)!)!;
    const fitted = ellipseOf(conic)!;
    expect(fitted.centre.x).toBeCloseTo(expected.centre.x, 3);
    expect(fitted.centre.y).toBeCloseTo(expected.centre.y, 3);
    expect(fitted.long).toBeCloseTo(expected.long, 3);
    expect(fitted.short).toBeCloseTo(expected.short, 3);
  });

  it('refuses points that make no ellipse', () => {
    expect(
      fitConic([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBeNull();
  });
});

describe('centreOfConcentric', () => {
  it("finds the record's centre in a tilted shot, which is not the ellipse's centre", () => {
    const camera = tiltedCamera(30, 70);
    const rim = mapConic(circleConic(record), camera)!;
    const ring = mapConic(circleConic(label), camera)!;
    const truth = apply(camera, { x: record.cx, y: record.cy });
    const centre = centreOfConcentric(rim, ring)!;
    expect(centre.x).toBeCloseTo(truth.x, 6);
    expect(centre.y).toBeCloseTo(truth.y, 6);
    // The point of all this: the ellipse's own centre is well off.
    const ellipse = ellipseOf(rim)!;
    expect(Math.hypot(ellipse.centre.x - truth.x, ellipse.centre.y - truth.y)).toBeGreaterThan(20);
  });

  it('finds it from fitted points too', () => {
    const camera = tiltedCamera(25, -40);
    const rim = fitConic(onCircle(record).map((p) => apply(camera, p)))!;
    const ring = fitConic(onCircle(label).map((p) => apply(camera, p)))!;
    const truth = apply(camera, { x: record.cx, y: record.cy });
    const centre = centreOfConcentric(rim, ring)!;
    expect(Math.hypot(centre.x - truth.x, centre.y - truth.y)).toBeLessThan(0.5);
  });

  it("has no answer for circles that aren't concentric", () => {
    const rim = circleConic(record);
    const ring = circleConic({ cx: record.cx + 600, cy: record.cy, r: 100 });
    expect(centreOfConcentric(rim, ring)).toBeNull();
  });
});

describe('straightening', () => {
  it('undoes the tilt: the record comes out round, with the label in the middle', () => {
    const camera = tiltedCamera(30, 70);
    const rim = mapConic(circleConic(record), camera)!;
    const centre = apply(camera, { x: record.cx, y: record.cy });
    const plan = straightening(rim, centre, 2000)!;
    const forward = invert(plan.toPhoto)!;
    const { cx, cy, r } = plan.rim;
    for (const p of onCircle(record, 36)) {
      const q = apply(forward, apply(camera, p));
      expect(Math.hypot(q.x - cx, q.y - cy) / r).toBeCloseTo(1, 6);
    }
    for (const p of onCircle(label, 36)) {
      const q = apply(forward, apply(camera, p));
      expect(Math.hypot(q.x - cx, q.y - cy) / r).toBeCloseTo(label.r / record.r, 6);
    }
    expect(plan.size).toBe(Math.ceil(2 * r * STRAIGHT_MARGIN));
  });

  it('keeps about the resolution the record had, within the limit', () => {
    const camera = tiltedCamera(20, 0);
    const rim = mapConic(circleConic(record), camera)!;
    const centre = apply(camera, { x: record.cx, y: record.cy });
    const ellipse = ellipseOf(rim)!;
    const free = straightening(rim, centre, 5000)!;
    expect(free.rim.r).toBeGreaterThan(ellipse.short * 0.9);
    expect(free.rim.r).toBeLessThan(ellipse.long * 1.1);
    expect(straightening(rim, centre, 300)!.rim.r).toBe(300);
  });

  it('without a centre, only stretches the rim round about its own centre', () => {
    const squashed: Mat3 = [1 / 400 ** 2, 0, 0, 0, 1 / 300 ** 2, 0, 0, 0, -1];
    const plan = straightening(squashed, null, 2000)!;
    const forward = invert(plan.toPhoto)!;
    const middle = apply(forward, { x: 0, y: 0 });
    expect(middle.x).toBeCloseTo(plan.rim.cx, 6);
    expect(middle.y).toBeCloseTo(plan.rim.cy, 6);
    expect(plan.rim.r).toBeCloseTo(Math.sqrt(400 * 300), 6);
  });
});

describe('planStraightening', () => {
  const camera = tiltedCamera(30, 70);
  const rimPoints = onCircle(record).map((p) => apply(camera, p));
  const ringPoints = onCircle(label).map((p) => apply(camera, p));

  it('straightens using the ring, so the label ends up centred', () => {
    const plan = planStraightening(rimPoints, ringPoints, 2000)!;
    const middle = apply(invert(plan.toPhoto)!, apply(camera, { x: record.cx, y: record.cy }));
    expect(Math.hypot(middle.x - plan.rim.cx, middle.y - plan.rim.cy) / plan.rim.r).toBeLessThan(
      0.002,
    );
  });

  it('falls back to stretching when there is no ring', () => {
    const plan = planStraightening(rimPoints, null, 2000)!;
    const forward = invert(plan.toPhoto)!;
    const off = (p: Point) => Math.hypot(p.x - plan.rim.cx, p.y - plan.rim.cy) / plan.rim.r;
    expect(Math.max(...rimPoints.map((p) => Math.abs(off(apply(forward, p)) - 1)))).toBeLessThan(
      0.04,
    );
  });

  it('ignores a ring that is not concentric with the rim', () => {
    const stray = onCircle({ cx: record.cx + 120, cy: record.cy, r: 100 }).map((p) =>
      apply(camera, p),
    );
    const plan = planStraightening(rimPoints, stray, 2000)!;
    expect(plan).not.toBeNull();
    const withRing = planStraightening(rimPoints, ringPoints, 2000)!;
    expect(plan.toPhoto).not.toEqual(withRing.toPhoto);
  });

  it('leaves a record shot head-on alone', () => {
    expect(planStraightening(onCircle(record), onCircle(label), 2000)).toBeNull();
  });
});

describe('warpImage', () => {
  it('samples the photo through the homography', () => {
    const width = 4;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([i * 30, 0, 0, 255], i * 4);
    // Output pixel (x, y) shows photo pixel (x + 2, y).
    const out = warpImage({ data, width, height }, [1, 0, 2, 0, 1, 0, 0, 0, 1], 2);
    expect(Array.from(out.filter((_, i) => i % 4 === 0))).toEqual([60, 90, 180, 210]);
  });
});
