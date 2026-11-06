import { describe, expect, it } from 'vitest';
import {
  centroid,
  circleMaskPath,
  clamp,
  clampCircle,
  clampPoint,
  discOutputSize,
  expandQuad,
  fitScale,
  fitSize,
  guideCircle,
  guideFrameQuad,
  isPlausibleSleeveQuad,
  loupeSide,
  orderCorners,
  pickSleeveQuad,
  pointInQuad,
  quadArea,
  quadBounds,
  quadMaskPath,
  quadPoints,
  Quad,
  scaleCircle,
  scalePoints,
  squareOutputSize,
  trueAspect,
  steadyDisc,
} from './camera-capture.logic';

const frame = { width: 1000, height: 800 };

const square: Quad = [
  { x: 100, y: 100 },
  { x: 700, y: 100 },
  { x: 700, y: 700 },
  { x: 100, y: 700 },
];

describe('orderCorners', () => {
  it('orders shuffled corners as TL, TR, BR, BL', () => {
    const shuffled = [square[2], square[0], square[3], square[1]];
    expect(orderCorners(shuffled)).toEqual(square);
  });

  it('handles a tilted sleeve without picking a corner twice', () => {
    const diamond = [
      { x: 500, y: 100 },
      { x: 900, y: 500 },
      { x: 500, y: 900 },
      { x: 100, y: 500 },
    ];
    const ordered = orderCorners([diamond[3], diamond[1], diamond[0], diamond[2]]);
    expect(new Set(ordered).size).toBe(4);
    // Clockwise from whichever corner is nearest the top-left.
    expect(ordered).toEqual([diamond[0], diamond[1], diamond[2], diamond[3]]);
  });

  it('keeps perspective-skewed quads clockwise', () => {
    const skewed = [
      { x: 120, y: 80 },
      { x: 880, y: 140 },
      { x: 820, y: 760 },
      { x: 60, y: 700 },
    ];
    expect(orderCorners([skewed[1], skewed[3], skewed[0], skewed[2]])).toEqual(skewed);
  });

  it('rejects anything but four points', () => {
    expect(() => orderCorners(square.slice(0, 3))).toThrow();
  });
});

describe('fitScale / fitSize', () => {
  it('downscales the longest edge to the cap', () => {
    expect(fitScale({ width: 4000, height: 3000 }, 800)).toBe(0.2);
    expect(fitSize({ width: 4000, height: 3000 }, 800)).toEqual({ width: 800, height: 600 });
  });

  it('never enlarges', () => {
    expect(fitScale({ width: 400, height: 300 }, 800)).toBe(1);
  });
});

describe('scalePoints / scaleCircle', () => {
  it('maps detection coordinates back to the full-size image', () => {
    const small = { width: 800, height: 600 };
    const big = { width: 4000, height: 3000 };
    expect(scalePoints([{ x: 80, y: 60 }], small, big)).toEqual([{ x: 400, y: 300 }]);
    expect(scaleCircle({ cx: 400, cy: 300, r: 100 }, small, big)).toEqual({
      cx: 2000,
      cy: 1500,
      r: 500,
    });
  });
});

describe('quadArea', () => {
  it('computes the area regardless of winding', () => {
    expect(quadArea(square)).toBe(360000);
    expect(quadArea([...square].reverse() as Quad)).toBe(360000);
  });
});

describe('isPlausibleSleeveQuad', () => {
  it('accepts a big, roughly square quad', () => {
    expect(isPlausibleSleeveQuad(square, frame)).toBe(true);
  });

  it('rejects a quad covering too little of the frame', () => {
    const tiny: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(isPlausibleSleeveQuad(tiny, frame)).toBe(false);
  });

  it('rejects corners far from square', () => {
    const kite: Quad = [
      { x: 400, y: 50 },
      { x: 750, y: 400 },
      { x: 400, y: 750 },
      { x: 300, y: 400 },
    ];
    expect(isPlausibleSleeveQuad(kite, frame)).toBe(false);
  });

  it('rejects a quad with a whole side on the image border', () => {
    const onTopEdge: Quad = [
      { x: 200, y: 2 },
      { x: 700, y: 3 },
      { x: 700, y: 500 },
      { x: 200, y: 500 },
    ];
    expect(isPlausibleSleeveQuad(onTopEdge, frame)).toBe(false);
  });

  it('accepts a sleeve with one corner near the border', () => {
    const corner: Quad = [
      { x: 5, y: 5 },
      { x: 600, y: 40 },
      { x: 580, y: 640 },
      { x: 20, y: 600 },
    ];
    expect(isPlausibleSleeveQuad(corner, frame)).toBe(true);
  });

  it('rejects a long thin strip', () => {
    const strip: Quad = [
      { x: 0, y: 200 },
      { x: 1000, y: 200 },
      { x: 1000, y: 600 },
      { x: 0, y: 600 },
    ];
    expect(isPlausibleSleeveQuad(strip, frame)).toBe(false);
  });
});

describe('squareOutputSize', () => {
  it('uses the mean side length', () => {
    expect(squareOutputSize(square)).toBe(600);
  });

  it('caps at the backend maximum', () => {
    const huge = scalePoints(square, { width: 1, height: 1 }, { width: 10, height: 10 });
    expect(squareOutputSize(huge)).toBe(2000);
  });
});

describe('guideFrameQuad / guideCircle', () => {
  it('centres a square on the shorter edge', () => {
    expect(guideFrameQuad(frame)).toEqual([
      { x: 180, y: 80 },
      { x: 820, y: 80 },
      { x: 820, y: 720 },
      { x: 180, y: 720 },
    ]);
  });

  it('centres a circle on the shorter edge', () => {
    expect(guideCircle(frame)).toEqual({ cx: 500, cy: 400, r: 336 });
  });
});

describe('clampPoint', () => {
  it('keeps handles inside the image', () => {
    expect(clampPoint({ x: -5, y: 900 }, frame)).toEqual({ x: 0, y: 800 });
  });
});

describe('loupeSide', () => {
  it('puts the magnifier on the side away from the handle', () => {
    expect(loupeSide({ x: 100, y: 50 }, frame)).toBe('right');
    expect(loupeSide({ x: 900, y: 50 }, frame)).toBe('left');
  });
});

describe('trueAspect', () => {
  const photo = { width: 3000, height: 2250 };
  const focal = 2400; // what a typical phone gives this photo

  /** A flat rectangle tilted away from a pinhole camera, as the camera sees it. */
  function seen(width: number, height: number, tilt: number): Quad {
    const corners = [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ];
    return corners.map(([x, y]) => {
      const depth = 5 + y * Math.sin(tilt);
      return {
        x: photo.width / 2 + (focal * x) / depth,
        y: photo.height / 2 + (focal * y * Math.cos(tilt)) / depth,
      };
    }) as Quad;
  }

  it('sees a square as square, however it is tilted', () => {
    expect(trueAspect(seen(2, 2, 0), photo)).toBeCloseTo(1, 3);
    expect(trueAspect(seen(2, 2, 0.5), photo)).toBeCloseTo(1, 3);
  });

  it('tells a tilted rectangle from a square', () => {
    expect(trueAspect(seen(2.4, 2, 0.5), photo)).toBeCloseTo(1.2, 3);
  });
});

describe('clampCircle', () => {
  it('pulls a circle back inside the frame', () => {
    expect(clampCircle({ cx: 990, cy: 10, r: 100 }, frame)).toEqual({ cx: 900, cy: 100, r: 100 });
  });

  it('limits the radius to half the shorter edge', () => {
    expect(clampCircle({ cx: 500, cy: 400, r: 2000 }, frame).r).toBe(400);
  });

  it('enforces a minimum radius', () => {
    expect(clampCircle({ cx: 500, cy: 400, r: 1 }, frame).r).toBe(20);
  });
});

describe('discOutputSize', () => {
  it('uses the diameter, capped', () => {
    expect(discOutputSize({ cx: 0, cy: 0, r: 300 })).toBe(600);
    expect(discOutputSize({ cx: 0, cy: 0, r: 5000 })).toBe(2000);
  });
});

describe('quadBounds', () => {
  it('returns the axis-aligned box clipped to the frame', () => {
    const q: Quad = [
      { x: -10, y: 50 },
      { x: 600, y: 40 },
      { x: 620, y: 900 },
      { x: 20, y: 610 },
    ];
    expect(quadBounds(q, frame)).toEqual({ x: 0, y: 40, width: 620, height: 760 });
  });
});

describe('pointInQuad / expandQuad', () => {
  it('tells inside from outside', () => {
    expect(pointInQuad({ x: 400, y: 400 }, square)).toBe(true);
    expect(pointInQuad({ x: 100, y: 400 }, square)).toBe(true); // on the edge
    expect(pointInQuad({ x: 90, y: 400 }, square)).toBe(false);
  });

  it('grows a quad about its centre', () => {
    expect(expandQuad(square, 2)).toEqual([
      { x: -200, y: -200 },
      { x: 1000, y: -200 },
      { x: 1000, y: 1000 },
      { x: -200, y: 1000 },
    ]);
  });
});

describe('pickSleeveQuad', () => {
  const shuffled = (q: Quad) => [q[2], q[0], q[3], q[1]];
  const shifted = (q: Quad, dx: number, dy: number) =>
    q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;

  it('returns null without plausible candidates', () => {
    expect(pickSleeveQuad([], frame)).toBeNull();
    const tiny: Quad = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    expect(pickSleeveQuad([{ corners: tiny, support: 1 }], frame)).toBeNull();
  });

  it('orders the corners of the winner', () => {
    expect(pickSleeveQuad([{ corners: shuffled(square), support: 0.9 }], frame)).toEqual(square);
  });

  it('prefers a crisp outline over a bigger blurry one (e.g. the shadow)', () => {
    const withShadow = expandQuad(square, 1.12);
    const picked = pickSleeveQuad(
      [
        { corners: withShadow, support: 0.4 },
        { corners: square, support: 0.95 },
      ],
      frame,
    );
    expect(picked).toEqual(square);
  });

  it('prefers the sleeve over a frame printed inside the cover', () => {
    const printedFrame = expandQuad(square, 0.85);
    const picked = pickSleeveQuad(
      [
        { corners: printedFrame, support: 1 },
        { corners: square, support: 0.6 },
      ],
      frame,
    );
    expect(picked).toEqual(square);
  });

  it('prefers the sleeve over a frame printed along only some of its sides', () => {
    const frameAtBottom: Quad = [square[0], square[1], { x: 700, y: 640 }, { x: 100, y: 640 }];
    const picked = pickSleeveQuad(
      [
        { corners: frameAtBottom, support: 1 },
        { corners: square, support: 0.7 },
      ],
      frame,
    );
    expect(picked).toEqual(square);
  });

  it('does not swap the sleeve for an outline tilted out along a crease', () => {
    const topOnCrease: Quad = [{ x: 100, y: 60 }, square[1], square[2], square[3]];
    const picked = pickSleeveQuad(
      [
        { corners: square, support: 1 },
        { corners: topOnCrease, support: 0.8 },
      ],
      frame,
    );
    expect(picked).toEqual(square);
  });

  it('does not let clutter stretch one side of the sleeve', () => {
    const bottomOnGrain: Quad = [square[0], square[1], { x: 700, y: 780 }, { x: 100, y: 780 }];
    const picked = pickSleeveQuad(
      [
        { corners: square, support: 0.9 },
        { corners: bottomOnGrain, support: 0.8 },
      ],
      frame,
    );
    expect(picked).toEqual(square);
  });

  it('averages candidates that agree, weighted by support', () => {
    const picked = pickSleeveQuad(
      [
        { corners: square, support: 1 },
        { corners: shifted(square, 10, 0), support: 1 },
      ],
      frame,
    )!;
    expect(picked[0].x).toBeCloseTo(105);
    expect(picked[0].y).toBeCloseTo(100);
  });
});

describe('clamp / centroid', () => {
  it('clamps into the range', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('averages the points', () => {
    expect(centroid(square)).toEqual({ x: 400, y: 400 });
  });
});

describe('SVG overlay helpers', () => {
  it('formats polygon points', () => {
    expect(quadPoints(square)).toBe('100,100 700,100 700,700 100,700');
  });

  it('cuts the quad out of the whole frame', () => {
    expect(quadMaskPath(square, frame)).toBe('M0 0H1000V800H0Z M100 100L700 100L700 700L100 700Z');
  });

  it('cuts the circle out of the whole frame', () => {
    expect(circleMaskPath({ cx: 500, cy: 400, r: 100 }, frame)).toBe(
      'M0 0H1000V800H0Z M400 400a100 100 0 1 0 200 0a100 100 0 1 0 -200 0Z',
    );
  });
});

describe('steadyDisc', () => {
  const shown = { cx: 200, cy: 200, r: 100 };

  it('shows the first detection as it is', () => {
    expect(steadyDisc(null, shown)).toEqual({ shown, pending: null });
  });

  it('eases through small differences', () => {
    const next = steadyDisc({ shown, pending: null }, { cx: 204, cy: 200, r: 100 });
    expect(next.shown.cx).toBeGreaterThan(200);
    expect(next.shown.cx).toBeLessThan(204);
  });

  it('ignores one odd frame', () => {
    const odd = steadyDisc({ shown, pending: null }, { cx: 300, cy: 240, r: 130 });
    expect(odd.shown).toEqual(shown);
    const after = steadyDisc(odd, { cx: 201, cy: 200, r: 100 });
    expect(after.pending).toBeNull();
    expect(Math.abs(after.shown.cx - 200)).toBeLessThan(1);
  });

  it('follows a record that really moved, once a second frame agrees', () => {
    const moved = { cx: 300, cy: 240, r: 100 };
    const first = steadyDisc({ shown, pending: null }, moved);
    expect(steadyDisc(first, { ...moved, cx: 302 }).shown).toEqual({ ...moved, cx: 302 });
  });
});
