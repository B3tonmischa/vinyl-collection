import { describe, expect, it } from 'vitest';
import { computeWindow, randomIndex, wrapIndex } from './vinyl-carousel.logic';

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
