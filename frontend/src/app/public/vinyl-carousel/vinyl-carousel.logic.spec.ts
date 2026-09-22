import { describe, expect, it } from 'vitest';
import {
  computeWindow,
  randomIndex,
  rollInDurationMs,
  spinStartIndex,
  spinTickDelays,
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

describe('spinTickDelays', () => {
  it('returns an empty schedule when there are no ticks or no duration', () => {
    expect(spinTickDelays(2400, 0)).toEqual([]);
    expect(spinTickDelays(0, 24)).toEqual([]);
  });

  it('produces one delay per tick that sums to roughly the total duration', () => {
    const delays = spinTickDelays(2400, 24);
    expect(delays).toHaveLength(24);
    const sum = delays.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(2350);
    expect(sum).toBeLessThanOrEqual(2450);
  });

  it('decelerates: each delay is at least as long as the previous one', () => {
    const delays = spinTickDelays(2400, 24);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it('starts near-instant and ends with a clearly longer pause before landing', () => {
    const delays = spinTickDelays(2400, 24);
    expect(delays[0]).toBeLessThan(10);
    expect(delays[delays.length - 1]).toBeGreaterThan(200);
  });
});

describe('spinStartIndex', () => {
  it('picks a start index that reaches target after tickCount forward steps', () => {
    const target = 6;
    const length = 10;
    const tickCount = 24;
    const start = spinStartIndex(target, length, tickCount);
    let center = start;
    for (let i = 0; i < tickCount; i++) {
      center = wrapIndex(center + 1, length);
    }
    expect(center).toBe(target);
  });

  it('wraps correctly for short collections so the spin still cycles through them', () => {
    const start = spinStartIndex(1, 3, 24);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(3);
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
