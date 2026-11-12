// Pure rules behind LightboxComponent: which photos it pages through, in
// what order, what each is called, and where the arrows and swipes lead.

import { ImageKind, VinylImage } from '../../models/vinyl.model';

export interface LightboxSlide {
  image: VinylImage;
  caption: string;
}

/** Packaging comes first, in the order you meet it handling the record; the discs follow. */
const KIND_ORDER: Record<ImageKind, number> = {
  COVER_FRONT: 0,
  INNER_SLEEVE_A: 1,
  INNER_SLEEVE_B: 2,
  COVER_BACK: 3,
  DISC_SIDE_A: 4,
  DISC_SIDE_B: 5,
};

const isDisc = (kind: ImageKind) => kind === 'DISC_SIDE_A' || kind === 'DISC_SIDE_B';

/**
 * A record's photos as the lightbox pages through them: front cover, inner
 * sleeves, back cover, then each disc by number with side A before side B.
 *
 * The images are the ones the API returned for the record; it already
 * leaves out soft-deleted ones, so every image passed in becomes a slide.
 */
export function lightboxSlides(images: readonly VinylImage[]): LightboxSlide[] {
  const sorted = [...images].sort((a, b) => {
    const aDisc = isDisc(a.kind);
    const bDisc = isDisc(b.kind);
    if (aDisc && bDisc && a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
  const discCount = new Set(images.filter((img) => isDisc(img.kind)).map((img) => img.discNumber))
    .size;
  const bothInner =
    images.some((img) => img.kind === 'INNER_SLEEVE_A') &&
    images.some((img) => img.kind === 'INNER_SLEEVE_B');
  return sorted.map((image) => ({ image, caption: slideCaption(image, discCount, bothInner) }));
}

/**
 * "Front cover", "Inner sleeve, left", "Side A" — or "Disc 2, side B" when
 * the record has several discs, matching the record viewer's own captions.
 */
export function slideCaption(image: VinylImage, discCount: number, bothInner: boolean): string {
  switch (image.kind) {
    case 'COVER_FRONT':
      return 'Front cover';
    case 'COVER_BACK':
      return 'Back cover';
    case 'INNER_SLEEVE_A':
      return bothInner ? 'Inner sleeve, left' : 'Inner sleeve';
    case 'INNER_SLEEVE_B':
      return bothInner ? 'Inner sleeve, right' : 'Inner sleeve';
    case 'DISC_SIDE_A':
    case 'DISC_SIDE_B': {
      const side = image.kind === 'DISC_SIDE_A' ? 'A' : 'B';
      return discCount > 1 ? `Disc ${image.discNumber}, side ${side}` : `Side ${side}`;
    }
  }
}

/** The slide showing the given image; the first slide when it isn't among them. */
export function startIndex(slides: readonly LightboxSlide[], imageId: number | null): number {
  const index = slides.findIndex((slide) => slide.image.id === imageId);
  return index === -1 ? 0 : index;
}

/** The slide `delta` steps on from `index`, wrapping round at either end. */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** "3 / 7" for the third of seven slides. */
export function positionLabel(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

/** How far a finger has to travel sideways for a swipe to count. */
export const SWIPE_MIN_PX = 40;

/**
 * Which way a touch gesture pages: 1 (next) for a swipe to the left, -1
 * (previous) for one to the right, 0 for a tap, a short drag, or one that
 * went more up or down than sideways (the page scrolling or a pinch).
 */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
