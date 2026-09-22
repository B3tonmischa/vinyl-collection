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
  return reducedMotion ? 0 : 2800;
}

/**
 * Septic (7th power) ease-out: near-linear (fast) at the start, then
 * decelerates hard into the landing — an even longer, slower "coasting
 * to a stop" tail than a quintic curve gives.
 */
export function easeOutSeptic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 7;
}

/**
 * The carousel's continuous fractional position at normalized time `t`
 * (0..1 across the roll-in duration): eases from `realStart` to
 * `realStart + distance`, landing exactly on the target at t=1.
 * Deliberately not wrapped to [0, length) — that happens only when
 * mapping individual slots to display indices, so the position itself
 * can be differenced/interpolated smoothly across the whole spin.
 */
export function spinPositionAt(realStart: number, distance: number, t: number): number {
  return realStart + distance * easeOutSeptic(t);
}

export interface CarouselSlotStyle {
  widthPx: number;
  opacity: number;
}

/** [distance, widthPx, opacity] anchor. */
export type SpinSizeAnchor = [number, number, number];

/**
 * Size anchors for the roll-in spin, matching the steady-state view's own
 * `cardSizeClass` Tailwind widths exactly (w-56/w-36/w-20 below the `sm`
 * breakpoint at 640px, w-64/w-44/w-24 at/above it) — so the spin lands on
 * a card that's already the right size instead of popping into it.
 */
export function spinSizeAnchors(wideViewport: boolean): SpinSizeAnchor[] {
  return wideViewport
    ? [
        [0, 256, 1],
        [1, 176, 0.8],
        [2, 96, 0.4],
        [3, 0, 0],
      ]
    : [
        [0, 224, 1],
        [1, 144, 0.8],
        [2, 80, 0.4],
        [3, 0, 0],
      ];
}

/**
 * Continuous card width/opacity as a function of `distance` — how many
 * slots a card currently sits from the (continuously moving) center.
 * Interpolates smoothly through `anchors` instead of snapping between
 * discrete buckets, so a card's size glides as the spin passes it rather
 * than jumping.
 */
export function spinSlotStyle(distance: number, anchors: SpinSizeAnchor[]): CarouselSlotStyle {
  const d = Math.abs(distance);
  for (let i = 0; i < anchors.length - 1; i++) {
    const [d0, w0, o0] = anchors[i];
    const [d1, w1, o1] = anchors[i + 1];
    if (d <= d1) {
      const t = (d - d0) / (d1 - d0);
      return { widthPx: w0 + (w1 - w0) * t, opacity: o0 + (o1 - o0) * t };
    }
  }
  return { widthPx: 0, opacity: 0 };
}

/**
 * Cumulative horizontal offset (px) of a card at continuous `distance`
 * slots from center, from the exact center point. Built by summing each
 * pair of adjacent anchors' half-widths plus `gapPx` — the same math a
 * flex row with `gap-3` produces — so this matches the steady-state
 * view's actual card positions exactly at every *integer* distance,
 * where the spin hands off to it, not just approximately.
 *
 * This is what keeps the center card pinned to the true center for the
 * whole spin: positioning cards via flex layout (auto-centered based on
 * total row width) only centers correctly when the visible cards'
 * widths are exactly symmetric, which is only true exactly at integer
 * positions — at every other fractional moment during the spin, the
 * asymmetric in-between widths pull the flex-centered midpoint away from
 * the actual center card, causing a visible drift right up to landing.
 */
export function spinOffsetPx(distance: number, anchors: SpinSizeAnchor[], gapPx: number): number {
  const sign = distance < 0 ? -1 : 1;
  const d = Math.abs(distance);
  const checkpoints = [0];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [, w0] = anchors[i];
    const [, w1] = anchors[i + 1];
    checkpoints.push(checkpoints[i] + w0 / 2 + gapPx + w1 / 2);
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [d0] = anchors[i];
    const [d1] = anchors[i + 1];
    if (d <= d1) {
      const t = (d - d0) / (d1 - d0);
      return sign * (checkpoints[i] + (checkpoints[i + 1] - checkpoints[i]) * t);
    }
  }
  return sign * checkpoints[checkpoints.length - 1];
}

export interface SpinSlot {
  /** Stable identity across frames (not wrapped) — safe to use as a track key. */
  virtualIndex: number;
  /** The actual vinyl list index this slot currently displays. */
  index: number;
  /** Signed distance from the continuous center, for interpolated styling. */
  distance: number;
}

/**
 * The filmstrip of nearby cards for a single continuous roll-in frame at
 * fractional `position`. Covers `radius` slots either side so cards can
 * fade in/out smoothly at the edges instead of popping in; wraps short
 * collections so they still visibly cycle past a few times.
 */
export function spinSlots(position: number, length: number, radius: number): SpinSlot[] {
  if (length <= 0) return [];
  const base = Math.floor(position);
  const frac = position - base;
  const slots: SpinSlot[] = [];
  for (let k = -radius; k <= radius; k++) {
    const virtualIndex = base + k;
    slots.push({ virtualIndex, index: wrapIndex(virtualIndex, length), distance: k - frac });
  }
  return slots;
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
