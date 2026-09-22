// Pure helpers extracted from VinylCarouselComponent so the random-start
// and wraparound logic can be unit-tested without instantiating the
// component (see the design plan's testing-approach section).

export interface CarouselWindowItem {
  offset: number;
  index: number;
}

/** Wraps `index` into the range [0, length). Assumes length > 0. */
export function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

/** Picks a random valid index into a list of the given length. */
export function randomIndex(length: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * length);
}

/**
 * Duration (ms) of the carousel's roll-in spin on landing. Tweak the
 * constant to adjust the feel. Reduced-motion preference skips the
 * animation entirely (0 = no animation).
 */
export function rollInDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 2400;
}

/**
 * Delays (ms) between each single-step advance of the roll-in "spin" —
 * as if someone were clicking "next" rapidly, then easing off. Delays
 * grow quadratically so the spin starts fast and decelerates to a stop,
 * and the whole sequence sums to approximately `totalDurationMs`.
 */
export function spinTickDelays(totalDurationMs: number, tickCount: number): number[] {
  if (tickCount <= 0 || totalDurationMs <= 0) return [];
  const weights = Array.from({ length: tickCount }, (_, i) => (i + 1) ** 3);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => Math.round((w / weightSum) * totalDurationMs));
}

/**
 * The index to start the roll-in spin from so that `tickCount` forward
 * single-step advances land exactly on `target`. Wraps around short
 * collections, so even a handful of records visibly cycle past a few
 * times before settling — like a wheel-of-fortune spin.
 */
export function spinStartIndex(target: number, length: number, tickCount: number): number {
  return wrapIndex(target - tickCount, length);
}

/**
 * Computes the 5-card display window (center ± 2) around `center`,
 * wrapping around the ends. When the collection is smaller than the
 * window, later (more-distant) offsets that would land on an
 * already-used index are dropped — the item closest to center wins,
 * since offsets are processed innermost-first.
 */
export function computeWindow(center: number, length: number): CarouselWindowItem[] {
  if (length <= 0) return [];
  const seen = new Set<number>();
  const result: CarouselWindowItem[] = [];
  for (const offset of [0, -1, 1, -2, 2]) {
    const index = wrapIndex(center + offset, length);
    if (seen.has(index)) continue;
    seen.add(index);
    result.push({ offset, index });
  }
  return result.sort((a, b) => a.offset - b.offset);
}
