import { describe, expect, it } from 'vitest';
import {
  computeWindow,
  easeOutQuintic,
  randomIndex,
  rollInDurationMs,
  spinPositionAt,
  spinSizeAnchors,
  spinSlotStyle,
  spinSlots,
  wrapIndex,
} from './vinyl-carousel.logic';

describe('wrapIndex', () => {
  it('returns the index unchanged when already in range', () => {
    expect(wrapIndex(2, 5)).toBe(2);
  });

  it('wraps a positive overflow back to the start', () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(7, 5)).toBe(2);
  });

  it('wraps a negative index to the end', () => {
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(-6, 5)).toBe(4);
  });

  it('handles a length of 1 by always returning 0', () => {
    expect(wrapIndex(0, 1)).toBe(0);
    expect(wrapIndex(5, 1)).toBe(0);
    expect(wrapIndex(-3, 1)).toBe(0);
  });
});

describe('randomIndex', () => {
  it('uses the injected rng to pick a deterministic index', () => {
    expect(randomIndex(10, () => 0)).toBe(0);
    expect(randomIndex(10, () => 0.99)).toBe(9);
    expect(randomIndex(4, () => 0.5)).toBe(2);
  });

  it('always lands within [0, length)', () => {
    for (const r of [0, 0.1, 0.4999, 0.5, 0.999999]) {
      const index = randomIndex(7, () => r);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });
});

describe('rollInDurationMs', () => {
  it('returns a multi-second duration by default', () => {
    const ms = rollInDurationMs(false);
    expect(ms).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThanOrEqual(3000);
  });

  it('returns zero (skip the animation) when reduced motion is preferred', () => {
    expect(rollInDurationMs(true)).toBe(0);
  });
});

describe('easeOutQuintic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutQuintic(0)).toBe(0);
    expect(easeOutQuintic(1)).toBe(1);
  });

  it('clamps outside [0, 1]', () => {
    expect(easeOutQuintic(-1)).toBe(0);
    expect(easeOutQuintic(2)).toBe(1);
  });

  it('is monotonically increasing', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const value = easeOutQuintic(t);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('decelerates: covers most of the distance early, coasting in at the end', () => {
    // A hard "coast to a stop" tail: by the halfway mark in time, it's
    // already most of the way there, then the last stretch is much slower.
    expect(easeOutQuintic(0.5)).toBeGreaterThan(0.9);
    const remainingAfterHalf = 1 - easeOutQuintic(0.5);
    const remainingAfterNinety = 1 - easeOutQuintic(0.9);
    expect(remainingAfterNinety).toBeLessThan(remainingAfterHalf);
  });
});

describe('spinPositionAt', () => {
  it('starts at realStart and lands exactly on realStart + distance', () => {
    expect(spinPositionAt(-14, 20, 0)).toBe(-14);
    expect(spinPositionAt(-14, 20, 1)).toBe(6);
  });

  it('is monotonically increasing over t for a positive distance', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const value = spinPositionAt(0, 20, t);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe('spinSizeAnchors', () => {
  it('matches the steady-state mobile widths (w-56/w-36/w-20) below the sm breakpoint', () => {
    expect(spinSizeAnchors(false)).toEqual([
      [0, 224, 1],
      [1, 144, 0.8],
      [2, 80, 0.4],
      [3, 0, 0],
    ]);
  });

  it('matches the steady-state sm+ widths (w-64/w-44/w-24) at/above the sm breakpoint', () => {
    expect(spinSizeAnchors(true)).toEqual([
      [0, 256, 1],
      [1, 176, 0.8],
      [2, 96, 0.4],
      [3, 0, 0],
    ]);
  });
});

describe('spinSlotStyle', () => {
  const anchors = spinSizeAnchors(false);

  it('is largest and fully opaque at distance 0', () => {
    expect(spinSlotStyle(0, anchors)).toEqual({ widthPx: 224, opacity: 1 });
  });

  it('shrinks to nothing by distance 3, symmetrically in both directions', () => {
    expect(spinSlotStyle(3, anchors)).toEqual({ widthPx: 0, opacity: 0 });
    expect(spinSlotStyle(-3, anchors)).toEqual({ widthPx: 0, opacity: 0 });
  });

  it('interpolates smoothly between anchors rather than snapping', () => {
    const atHalf = spinSlotStyle(0.5, anchors);
    expect(atHalf.widthPx).toBeGreaterThan(spinSlotStyle(1, anchors).widthPx);
    expect(atHalf.widthPx).toBeLessThan(spinSlotStyle(0, anchors).widthPx);
  });

  it('shrinks monotonically as distance grows', () => {
    let prevWidth = Infinity;
    for (let d = 0; d <= 3; d += 0.25) {
      const { widthPx } = spinSlotStyle(d, anchors);
      expect(widthPx).toBeLessThanOrEqual(prevWidth);
      prevWidth = widthPx;
    }
  });
});

describe('spinSlots', () => {
  it('returns 2*radius + 1 slots centered on the fractional position', () => {
    const slots = spinSlots(4.3, 10, 3);
    expect(slots).toHaveLength(7);
    expect(slots.map((s) => s.virtualIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('derives distance from the fractional part of position', () => {
    const slots = spinSlots(4.3, 10, 1);
    // base = 4, frac = 0.3 -> distances are k - frac for k in [-1, 0, 1]
    expect(slots.map((s) => Number(s.distance.toFixed(2)))).toEqual([-1.3, -0.3, 0.7]);
  });

  it('wraps virtual indices into valid list indices', () => {
    const slots = spinSlots(0.5, 3, 3);
    for (const slot of slots) {
      expect(slot.index).toBeGreaterThanOrEqual(0);
      expect(slot.index).toBeLessThan(3);
    }
  });

  it('returns nothing for an empty collection', () => {
    expect(spinSlots(0, 0, 3)).toEqual([]);
  });
});

describe('computeWindow', () => {
  it('returns an empty window for a length of 0', () => {
    expect(computeWindow(0, 0)).toEqual([]);
  });

  it('returns a single centered item when length is 1', () => {
    expect(computeWindow(0, 1)).toEqual([{ offset: 0, index: 0 }]);
  });

  it('builds the full 5-card window in offset order, wrapping at both ends', () => {
    // length 10, center 0: -2/-1 wrap to the tail end.
    expect(computeWindow(0, 10)).toEqual([
      { offset: -2, index: 8 },
      { offset: -1, index: 9 },
      { offset: 0, index: 0 },
      { offset: 1, index: 1 },
      { offset: 2, index: 2 },
    ]);
  });

  it('wraps correctly when centered near the end of the collection', () => {
    // length 10, center 9: +1/+2 wrap to the front.
    expect(computeWindow(9, 10)).toEqual([
      { offset: -2, index: 7 },
      { offset: -1, index: 8 },
      { offset: 0, index: 9 },
      { offset: 1, index: 0 },
      { offset: 2, index: 1 },
    ]);
  });

  it('drops distant offsets that collide once the collection is smaller than the window', () => {
    // length 3: offsets 0,-1,1 cover every index; -2 and 2 would collide
    // with already-used indices and are dropped (closest-to-center wins).
    const result = computeWindow(0, 3);
    expect(result).toEqual([
      { offset: -1, index: 2 },
      { offset: 0, index: 0 },
      { offset: 1, index: 1 },
    ]);
  });

  it('returns exactly two items for a length of 2 (both directions collide)', () => {
    const result = computeWindow(0, 2);
    expect(result).toEqual([
      { offset: -1, index: 1 },
      { offset: 0, index: 0 },
    ]);
  });

  it('never returns duplicate indices regardless of length', () => {
    for (let length = 1; length <= 8; length++) {
      for (let center = 0; center < length; center++) {
        const result = computeWindow(center, length);
        const indices = result.map((item) => item.index);
        expect(new Set(indices).size).toBe(indices.length);
        expect(indices.length).toBe(Math.min(5, length));
      }
    }
  });
});
