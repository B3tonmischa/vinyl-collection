import { describe, expect, it } from 'vitest';
import { ImageKind, VinylImage } from '../../models/vinyl.model';
import {
  lightboxSlides,
  positionLabel,
  slideCaption,
  startIndex,
  stepIndex,
  swipeStep,
} from './lightbox.logic';

let nextId = 1;
function image(kind: ImageKind, discNumber = 1): VinylImage {
  const id = nextId++;
  return { id, kind, discNumber, fullPath: `${id}-full.webp`, thumbPath: `${id}-thumb.webp` };
}

describe('lightboxSlides', () => {
  it('orders packaging front to back, then discs by number with side A first', () => {
    const d2b = image('DISC_SIDE_B', 2);
    const back = image('COVER_BACK');
    const d1a = image('DISC_SIDE_A', 1);
    const innerB = image('INNER_SLEEVE_B');
    const d2a = image('DISC_SIDE_A', 2);
    const front = image('COVER_FRONT');
    const innerA = image('INNER_SLEEVE_A');
    const d1b = image('DISC_SIDE_B', 1);

    const slides = lightboxSlides([d2b, back, d1a, innerB, d2a, front, innerA, d1b]);

    expect(slides.map((s) => s.image)).toEqual([front, innerA, innerB, back, d1a, d1b, d2a, d2b]);
  });

  it('makes a slide of exactly the images it is given', () => {
    // The API already drops soft-deleted images, so whatever arrives is shown.
    const images = [image('COVER_FRONT'), image('DISC_SIDE_A')];
    expect(lightboxSlides(images)).toHaveLength(2);
    expect(lightboxSlides([])).toEqual([]);
  });

  it('captions each slide', () => {
    const slides = lightboxSlides([
      image('COVER_FRONT'),
      image('COVER_BACK'),
      image('INNER_SLEEVE_A'),
      image('INNER_SLEEVE_B'),
      image('DISC_SIDE_A', 1),
      image('DISC_SIDE_B', 2),
    ]);
    expect(slides.map((s) => s.caption)).toEqual([
      'Front cover',
      'Inner sleeve, left',
      'Inner sleeve, right',
      'Back cover',
      'Disc 1, side A',
      'Disc 2, side B',
    ]);
  });

  it('leaves out the disc number and the inner sleeve side when there is only one', () => {
    const slides = lightboxSlides([
      image('INNER_SLEEVE_B'),
      image('DISC_SIDE_A', 1),
      image('DISC_SIDE_B', 1),
    ]);
    expect(slides.map((s) => s.caption)).toEqual(['Inner sleeve', 'Side A', 'Side B']);
  });
});

describe('slideCaption', () => {
  it('names a disc side by its disc on a multi-disc record', () => {
    expect(slideCaption(image('DISC_SIDE_B', 3), 3, false)).toBe('Disc 3, side B');
  });
});

describe('startIndex', () => {
  const slides = lightboxSlides([
    image('COVER_FRONT'),
    image('COVER_BACK'),
    image('DISC_SIDE_A'),
  ]);

  it('starts on the clicked image', () => {
    expect(startIndex(slides, slides[2].image.id)).toBe(2);
    expect(startIndex(slides, slides[1].image.id)).toBe(1);
  });

  it('falls back to the first slide for an unknown or missing image', () => {
    expect(startIndex(slides, -1)).toBe(0);
    expect(startIndex(slides, null)).toBe(0);
  });
});

describe('stepIndex', () => {
  it('moves forward and back', () => {
    expect(stepIndex(2, 1, 7)).toBe(3);
    expect(stepIndex(2, -1, 7)).toBe(1);
  });

  it('wraps from the last slide to the first and back', () => {
    expect(stepIndex(6, 1, 7)).toBe(0);
    expect(stepIndex(0, -1, 7)).toBe(6);
  });

  it('stays put with a single slide', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });

  it('copes with no slides', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe('positionLabel', () => {
  it('counts from one', () => {
    expect(positionLabel(2, 7)).toBe('3 / 7');
    expect(positionLabel(0, 1)).toBe('1 / 1');
  });
});

describe('swipeStep', () => {
  it('pages forward on a swipe to the left and back on one to the right', () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
  });

  it('ignores taps, short drags and mostly vertical gestures', () => {
    expect(swipeStep(0, 0)).toBe(0);
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0);
  });
});
