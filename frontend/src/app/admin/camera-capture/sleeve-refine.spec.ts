import { describe, expect, it } from 'vitest';
import { Point, Quad } from './camera-capture.logic';
import { Pixels, refineSleeveQuad } from './sleeve-refine';

type Rgb = [number, number, number];

function image(width: number, height: number, color: (x: number, y: number) => Rgb): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data.set([...color(x + 0.5, y + 0.5), 255], i);
    }
  }
  return { data, width, height };
}

// A dark 200 px sleeve on a light sheet, edges at 100 and 300.
const SHEET: Rgb = [215, 205, 185];
const SLEEVE: Rgb = [30, 25, 22];
const inSleeve = (x: number, y: number) => x > 100 && x < 300 && y > 100 && y < 300;
const truth: Quad = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

/** Corners pushed `by` px outward, with a slight twist. */
function offset(by: number): Quad {
  return truth.map((p, i) => ({
    x: p.x + (p.x < 200 ? -by : by) + (i % 2 ? 2 : -2),
    y: p.y + (p.y < 200 ? -by : by),
  })) as Quad;
}

function worstError(quad: Quad): number {
  return Math.max(...quad.map((p: Point, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)));
}

describe('refineSleeveQuad', () => {
  it('snaps a rough outline onto the sleeve edges', () => {
    const photo = image(400, 400, (x, y) => (inSleeve(x, y) ? SLEEVE : SHEET));
    expect(worstError(offset(8))).toBeGreaterThan(8);
    expect(worstError(refineSleeveQuad(photo, offset(8), 20))).toBeLessThan(1);
    expect(worstError(refineSleeveQuad(photo, offset(-6), 20))).toBeLessThan(1);
  });

  it('stops at the sleeve, not at the outer rim of its shadow', () => {
    // A 12 px shadow below the sleeve: the sheet at half brightness, which
    // has more contrast against the sheet than against the dark sleeve.
    const shadow: Rgb = [110, 100, 85];
    const photo = image(400, 400, (x, y) => {
      if (inSleeve(x, y)) return SLEEVE;
      if (x > 100 && x < 300 && y > 300 && y < 312) return shadow;
      return SHEET;
    });
    const start = [...truth] as Quad;
    start[2] = { x: 300, y: 312 };
    start[3] = { x: 100, y: 312 };
    expect(worstError(refineSleeveQuad(photo, start, 20))).toBeLessThan(1);
  });

  it('ignores a thin frame line printed just inside the edge', () => {
    const photo = image(400, 400, (x, y) => {
      if (!inSleeve(x, y)) return SHEET;
      const fromEdge = Math.min(x - 100, 300 - x, y - 100, 300 - y);
      return fromEdge > 10 && fromEdge < 13 ? [230, 230, 230] : SLEEVE;
    });
    expect(worstError(refineSleeveQuad(photo, offset(-8), 20))).toBeLessThan(1);
  });

  it('keeps the outline when there is no edge to find', () => {
    const blank = image(400, 400, () => SHEET);
    expect(refineSleeveQuad(blank, offset(8), 20)).toEqual(offset(8));
  });

  it('keeps a side whose edge lies beyond the band', () => {
    const photo = image(400, 400, (x, y) => (inSleeve(x, y) ? SLEEVE : SHEET));
    const refined = refineSleeveQuad(photo, offset(25), 10);
    expect(refined).toEqual(offset(25));
  });
});
