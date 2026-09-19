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
