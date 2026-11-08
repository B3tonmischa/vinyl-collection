import { describe, expect, it } from 'vitest';
import {
  canAnimateStep,
  clampStepTarget,
  computeWindow,
  easeOutCubic,
  easeOutSeptic,
  easedPosition,
  randomIndex,
  rollInDurationMs,
  spinOffsetPx,
  spinPositionAt,
  spinSizeAnchors,
  spinSlotStyle,
  spinAgainTarget,
  spinSlots,
  startIndex,
  stepDurationMs,
  wrapIndex,
} from './vinyl-carousel.logic';

describe('stepDurationMs', () => {
  it('is slower than the old 300ms CSS transition', () => {
    expect(stepDurationMs(false)).toBeGreaterThan(300);
  });

  it('is shorter than the roll-in', () => {
    expect(stepDurationMs(false)).toBeLessThan(rollInDurationMs(false));
  });

  it('is 0 under reduced motion', () => {
    expect(stepDurationMs(true)).toBe(0);
  });
});

describe('easeOutCubic', () => {
  it('runs from 0 to 1 and clamps outside that range', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('is gentler at the start than the septic roll-in curve', () => {
    expect(easeOutCubic(0.1)).toBeLessThan(easeOutSeptic(0.1));
  });

  it('only increases', () => {
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = easeOutCubic(i / 20);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('easedPosition', () => {
  it('starts at from and lands exactly on to', () => {
    expect(easedPosition(3, 5, 0, easeOutCubic)).toBe(3);
    expect(easedPosition(3, 5, 1, easeOutCubic)).toBe(5);
    expect(easedPosition(3, 5, 1.4, easeOutCubic)).toBe(5);
  });

  it('moves backwards when to is below from', () => {
    const mid = easedPosition(4, 2, 0.5, easeOutCubic);
    expect(mid).toBeLessThan(4);
    expect(mid).toBeGreaterThan(2);
  });
});

describe('canAnimateStep', () => {
  it('needs at least the 5-card window', () => {
    expect(canAnimateStep(0)).toBe(false);
    expect(canAnimateStep(1)).toBe(false);
    expect(canAnimateStep(4)).toBe(false);
    expect(canAnimateStep(5)).toBe(true);
    expect(canAnimateStep(200)).toBe(true);
  });
});

describe('clampStepTarget', () => {
  it('passes a nearby request through', () => {
    expect(clampStepTarget(11, 10, 2)).toBe(11);
    expect(clampStepTarget(8, 10, 2)).toBe(8);
  });

  it('holds a runaway request within maxLead slots of the position', () => {
    expect(clampStepTarget(20, 10, 2)).toBe(12);
    expect(clampStepTarget(0, 10, 2)).toBe(8);
  });

  it('always lands on a whole slot, even from a fractional position', () => {
    expect(clampStepTarget(20, 10.4, 2)).toBe(12);
    expect(clampStepTarget(0, 10.4, 2)).toBe(9);
  });

  it('keeps going past the wrap, since positions are unwrapped', () => {
    expect(clampStepTarget(-1, 0, 2)).toBe(-1);
  });
});

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

describe('easeOutSeptic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutSeptic(0)).toBe(0);
    expect(easeOutSeptic(1)).toBe(1);
  });

  it('clamps outside [0, 1]', () => {
    expect(easeOutSeptic(-1)).toBe(0);
    expect(easeOutSeptic(2)).toBe(1);
  });

  it('is monotonically increasing', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const value = easeOutSeptic(t);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('decelerates: covers most of the distance early, coasting in at the end', () => {
    // A hard "coast to a stop" tail: by the halfway mark in time, it's
    // already most of the way there, then the last stretch is much slower.
    expect(easeOutSeptic(0.5)).toBeGreaterThan(0.9);
    const remainingAfterHalf = 1 - easeOutSeptic(0.5);
    const remainingAfterNinety = 1 - easeOutSeptic(0.9);
    expect(remainingAfterNinety).toBeLessThan(remainingAfterHalf);
  });

  it('crawls in more slowly than a quintic curve right before landing', () => {
    // Higher-power curves cover more distance earlier, but their velocity
    // right at the end — which is what actually reads as "slow tail" —
    // is smaller than a lower-power curve's.
    const quintic = (t: number) => 1 - (1 - t) ** 5;
    const dt = 0.001;
    const velocity = (fn: (t: number) => number) => (fn(1 - dt) - fn(1 - 2 * dt)) / dt;
    expect(velocity(easeOutSeptic)).toBeLessThan(velocity(quintic));
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

describe('spinOffsetPx', () => {
  const anchors = spinSizeAnchors(true); // [0,256,1], [1,176,0.8], [2,96,0.4], [3,0,0]
  const gap = 12;

  it('is exactly 0 at distance 0 — the true center, always', () => {
    expect(spinOffsetPx(0, anchors, gap)).toBe(0);
  });

  it('matches the steady-state flex row position exactly at each integer distance', () => {
    // Same numbers a flex row of these widths + gap-3, centered, produces:
    // half(256) + gap + half(176) = 128+12+88 = 228; then +88+12+48 = 148 more.
    expect(spinOffsetPx(1, anchors, gap)).toBe(228);
    expect(spinOffsetPx(2, anchors, gap)).toBe(376);
  });

  it('is symmetric for negative distances', () => {
    expect(spinOffsetPx(-1, anchors, gap)).toBe(-228);
    expect(spinOffsetPx(-2, anchors, gap)).toBe(-376);
  });

  it('is continuous and monotonically increasing with distance', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 3; d += 0.1) {
      const offset = spinOffsetPx(d, anchors, gap);
      expect(offset).toBeGreaterThanOrEqual(prev);
      prev = offset;
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

describe('startIndex', () => {
  it('restores the remembered record by id, wherever it now sits', () => {
    expect(startIndex([7, 3, 9], 9)).toEqual({ index: 2, restored: true });
  });

  it('picks a random record when nothing is remembered', () => {
    expect(startIndex([7, 3, 9], null, () => 0.5)).toEqual({ index: 1, restored: false });
  });

  it('picks a random record when the remembered one is gone', () => {
    expect(startIndex([7, 3, 9], 42, () => 0)).toEqual({ index: 0, restored: false });
  });
});

describe('spinAgainTarget', () => {
  it('travels at least the full spin distance forward', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(spinAgainTarget(4, 10, 20, () => r)).toBeGreaterThanOrEqual(24);
    }
  });

  it('never lands back on the current record', () => {
    for (let i = 0; i < 9; i++) {
      const r = i / 9;
      expect(wrapIndex(spinAgainTarget(4, 10, 20, () => r), 10)).not.toBe(4);
    }
  });

  it('can land on every other record', () => {
    const landed = new Set<number>();
    for (let i = 0; i < 9; i++) landed.add(wrapIndex(spinAgainTarget(4, 10, 20, () => i / 9), 10));
    expect([...landed].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
  });

  it('works from an unwrapped (negative or large) slot', () => {
    expect(wrapIndex(spinAgainTarget(-13, 10, 20, () => 0), 10)).toBe(0);
    expect(wrapIndex(spinAgainTarget(37, 10, 20, () => 0.99), 10)).toBe(9);
  });

  it('just spins the distance with a single record', () => {
    expect(spinAgainTarget(0, 1, 20)).toBe(20);
  });
});
