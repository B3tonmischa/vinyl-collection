import { describe, expect, it } from 'vitest';
import { ImageKind, VinylImage } from '../../models/vinyl.model';
import {
  canFlip,
  discSideLabel,
  facingImage,
  innerPanels,
  focusesDiscs,
  recordLayout,
  recordParts,
  shownSide,
  viewAfterFaceClick,
} from './record-viewer.logic';

let nextId = 1;
function image(kind: ImageKind, discNumber = 1): VinylImage {
  const id = nextId++;
  return { id, kind, discNumber, fullPath: `${id}-full.webp`, thumbPath: `${id}-thumb.webp` };
}

describe('recordParts', () => {
  it('sorts photos into the parts of the record', () => {
    const front = image('COVER_FRONT');
    const back = image('COVER_BACK');
    const innerA = image('INNER_SLEEVE_A');
    const parts = recordParts([back, innerA, front]);

    expect(parts.front).toBe(front);
    expect(parts.back).toBe(back);
    expect(parts.innerA).toBe(innerA);
    expect(parts.innerB).toBeNull();
    expect(parts.hasInner).toBe(true);
    expect(parts.isEmpty).toBe(false);
  });

  it('groups disc sides by disc and orders discs by number', () => {
    const d2b = image('DISC_SIDE_B', 2);
    const d1a = image('DISC_SIDE_A', 1);
    const d2a = image('DISC_SIDE_A', 2);
    const { discs } = recordParts([d2b, d1a, d2a]);

    expect(discs.map((d) => d.discNumber)).toEqual([1, 2]);
    expect(discs[0]).toEqual({ discNumber: 1, sideA: d1a, sideB: null });
    expect(discs[1]).toEqual({ discNumber: 2, sideA: d2a, sideB: d2b });
  });

  it('has no inner sleeve and no discs for a cover-only record', () => {
    const parts = recordParts([image('COVER_FRONT')]);
    expect(parts.hasInner).toBe(false);
    expect(parts.discs).toEqual([]);
  });

  it('is empty without photos', () => {
    expect(recordParts([]).isEmpty).toBe(true);
  });
});

describe('viewAfterFaceClick', () => {
  const gatefold = recordParts([
    image('COVER_FRONT'),
    image('COVER_BACK'),
    image('INNER_SLEEVE_A'),
    image('INNER_SLEEVE_B'),
  ]);
  const plain = recordParts([image('COVER_FRONT'), image('COVER_BACK')]);
  const frontOnly = recordParts([image('COVER_FRONT')]);
  const gatefoldNoBack = recordParts([image('COVER_FRONT'), image('INNER_SLEEVE_B')]);

  it('opens a sleeve that has inner sleeves', () => {
    expect(viewAfterFaceClick('front', gatefold)).toBe('open');
  });

  it('turns straight to the back cover when there are no inner sleeves', () => {
    expect(viewAfterFaceClick('front', plain)).toBe('back');
  });

  it('stays on the front when there is nothing else to show', () => {
    expect(viewAfterFaceClick('front', frontOnly)).toBe('front');
  });

  it('closes on the front cover from the left inner sleeve', () => {
    expect(viewAfterFaceClick('inner-a', gatefold)).toBe('front');
  });

  it('closes and turns to the back cover from the right inner sleeve', () => {
    expect(viewAfterFaceClick('inner-b', gatefold)).toBe('back');
  });

  it('just closes from the right inner sleeve when there is no back cover', () => {
    expect(viewAfterFaceClick('inner-b', gatefoldNoBack)).toBe('front');
  });

  it('turns from the back cover to the front', () => {
    expect(viewAfterFaceClick('back', plain)).toBe('front');
  });
});

describe('innerPanels', () => {
  const innerA = image('INNER_SLEEVE_A');
  const innerB = image('INNER_SLEEVE_B');

  it('gives each panel its own photo when both exist', () => {
    expect(innerPanels(recordParts([innerA, innerB]), null)).toEqual({
      left: { image: innerA, half: null },
      right: { image: innerB, half: null },
    });
  });

  it('keeps a lone photo on its own panel until its shape is known', () => {
    expect(innerPanels(recordParts([innerA]), null)).toEqual({
      left: { image: innerA, half: null },
      right: null,
    });
    expect(innerPanels(recordParts([innerB]), 1)).toEqual({
      left: null,
      right: { image: innerB, half: null },
    });
  });

  it('splits a lone wide photo of the opened sleeve across both panels', () => {
    expect(innerPanels(recordParts([innerA]), 2)).toEqual({
      left: { image: innerA, half: 'left' },
      right: { image: innerA, half: 'right' },
    });
  });

  it('ignores the aspect when both photos exist', () => {
    expect(innerPanels(recordParts([innerA, innerB]), 2).left?.half).toBeNull();
  });

  it('has nothing to show without inner sleeves', () => {
    expect(innerPanels(recordParts([]), null)).toEqual({ left: null, right: null });
  });
});

describe('disc sides', () => {
  const both = { discNumber: 1, sideA: image('DISC_SIDE_A'), sideB: image('DISC_SIDE_B') };
  const onlyA = { discNumber: 1, sideA: image('DISC_SIDE_A'), sideB: null };
  const onlyB = { discNumber: 2, sideA: null, sideB: image('DISC_SIDE_B', 2) };

  it('can turn over only a disc with both sides photographed', () => {
    expect(canFlip(both)).toBe(true);
    expect(canFlip(onlyA)).toBe(false);
    expect(canFlip(onlyB)).toBe(false);
  });

  it('shows side A first and side B once turned over', () => {
    expect(shownSide(both, false)).toBe('A');
    expect(shownSide(both, true)).toBe('B');
  });

  it('shows the only side there is', () => {
    expect(shownSide(onlyA, true)).toBe('A');
    expect(shownSide(onlyB, false)).toBe('B');
  });

  it('names the disc only when there are several', () => {
    expect(discSideLabel(both, false, 1)).toBe('Side A');
    expect(discSideLabel(onlyB, false, 2)).toBe('Disc 2, side B');
  });
});

describe('focusesDiscs', () => {
  it('is on for a phone-sized space only, once measured', () => {
    expect(focusesDiscs(380)).toBe(true);
    expect(focusesDiscs(600)).toBe(false);
    expect(focusesDiscs(0)).toBe(false);
  });
});

describe('recordLayout', () => {
  it('caps the sleeve at 400px and centres the resting record', () => {
    const layout = recordLayout(1000, 'front', false, 1);
    expect(layout.size).toBe(400);
    expect(layout.scale).toBe(1);
    // sleeve plus a disc peeking out: 400 * (0.5 + 0.94) = 576 wide
    expect(layout.x).toBeCloseTo((1000 - 576) / 2);
    expect(layout.slot).toBe(0);
  });

  it('centres a record without discs on the sleeve alone', () => {
    expect(recordLayout(1000, 'front', false, 0).x).toBe(300);
  });

  it('makes room for the opened left panel', () => {
    const layout = recordLayout(1000, 'open', false, 1);
    expect(layout.slot).toBe(400);
    expect(layout.x).toBe(100);
  });

  it('scales the record down when the discs rolled out need more room', () => {
    const layout = recordLayout(1000, 'front', true, 2);
    // 400 * (1.04 + 1 + 0.94) = 1192 wide
    expect(layout.scale).toBeCloseTo(1000 / 1192);
    expect(layout.x).toBeCloseTo(0);
    expect(layout.y).toBeCloseTo((400 - 400 * (1000 / 1192)) / 2);
  });

  it('takes 62% of a narrow space', () => {
    expect(recordLayout(300, 'front', false, 1).size).toBeCloseTo(186);
  });

  it('centres the focused disc on a phone and leaves a quarter of the sleeve in view', () => {
    const layout = recordLayout(380, 'front', true, 2, 0);
    const shown = layout.size * layout.scale;
    expect(shown).toBeCloseTo(380 / 1.52);
    // right edge of the sleeve
    expect(layout.x + shown).toBeCloseTo(0.25 * shown);
    // centre of the first disc
    expect(layout.x + (1.04 + 0.47) * shown).toBeCloseTo(190);
  });

  it('slides the next disc into the centre when it is focused', () => {
    const first = recordLayout(380, 'front', true, 2, 0);
    const second = recordLayout(380, 'front', true, 2, 1);
    expect(second.scale).toBeCloseTo(first.scale);
    expect(first.x - second.x).toBeCloseTo(first.size * first.scale);
  });

  it('ignores the focused disc while the discs are in the sleeve', () => {
    expect(recordLayout(380, 'front', false, 2, 0)).toEqual(recordLayout(380, 'front', false, 2));
  });

  it('never divides by zero before it has been measured', () => {
    expect(recordLayout(0, 'front', false, 1)).toEqual({ size: 0, scale: 1, x: 0, y: 0, slot: 0 });
  });
});

describe('facingImage', () => {
  const front = image('COVER_FRONT');
  const back = image('COVER_BACK');
  const innerB = image('INNER_SLEEVE_B');
  const d1a = image('DISC_SIDE_A', 1);
  const d1b = image('DISC_SIDE_B', 1);
  const d2a = image('DISC_SIDE_A', 2);
  const parts = recordParts([front, back, innerB, d1a, d1b, d2a]);
  const none = new Set<number>();

  it('is the cover or inner sleeve on show', () => {
    expect(facingImage(parts, 'front', false, none, null)).toBe(front);
    expect(facingImage(parts, 'open', false, none, null)).toBe(innerB);
    expect(facingImage(parts, 'back', false, none, null)).toBe(back);
  });

  it('is the upward side of the first or the centred disc once they are out', () => {
    expect(facingImage(parts, 'front', true, none, null)).toBe(d1a);
    expect(facingImage(parts, 'front', true, new Set([1]), null)).toBe(d1b);
    expect(facingImage(parts, 'front', true, none, 1)).toBe(d2a);
  });

  it('falls back to the front cover, or nothing without one', () => {
    expect(facingImage(recordParts([front]), 'back', false, none, null)).toBe(front);
    expect(facingImage(recordParts([d1b]), 'front', false, none, null)).toBeNull();
  });
});
