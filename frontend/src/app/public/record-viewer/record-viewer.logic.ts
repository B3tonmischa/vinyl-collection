// Pure rules behind RecordViewerComponent, extracted so they can be
// unit-tested without rendering the 3D scene.

import { VinylImage } from '../../models/vinyl.model';

/** Which face of the sleeve is towards the viewer. */
export type SleeveView = 'front' | 'open' | 'back';

/** A clickable surface of the sleeve. */
export type SleeveFace = 'front' | 'inner-a' | 'inner-b' | 'back';

export interface RecordDisc {
  discNumber: number;
  sideA: VinylImage | null;
  sideB: VinylImage | null;
}

export interface RecordParts {
  front: VinylImage | null;
  back: VinylImage | null;
  innerA: VinylImage | null;
  innerB: VinylImage | null;
  /** Ordered by disc number: the first is on top in the sleeve and nearest it when rolled out. */
  discs: RecordDisc[];
  /** The sleeve opens like a gatefold when it has at least one inner sleeve photo. */
  hasInner: boolean;
  isEmpty: boolean;
}

/** Sorts a record's photos into the parts of the physical object. */
export function recordParts(images: VinylImage[]): RecordParts {
  const packaging = (kind: VinylImage['kind']) => images.find((img) => img.kind === kind) ?? null;
  const discs = new Map<number, RecordDisc>();
  for (const img of images) {
    if (img.kind !== 'DISC_SIDE_A' && img.kind !== 'DISC_SIDE_B') continue;
    const disc = discs.get(img.discNumber) ?? {
      discNumber: img.discNumber,
      sideA: null,
      sideB: null,
    };
    if (img.kind === 'DISC_SIDE_A') disc.sideA = img;
    else disc.sideB = img;
    discs.set(img.discNumber, disc);
  }
  const innerA = packaging('INNER_SLEEVE_A');
  const innerB = packaging('INNER_SLEEVE_B');
  return {
    front: packaging('COVER_FRONT'),
    back: packaging('COVER_BACK'),
    innerA,
    innerB,
    discs: [...discs.values()].sort((a, b) => a.discNumber - b.discNumber),
    hasInner: innerA !== null || innerB !== null,
    isEmpty: images.length === 0,
  };
}

/** What an opened panel shows: a photo, or one half of a photo of the whole spread. */
export interface PanelImage {
  image: VinylImage;
  half: 'left' | 'right' | null;
}

/** A lone inner sleeve photo at least this wide (width / height) is a photo of the opened spread. */
export const SPREAD_ASPECT = 1.5;

/**
 * What the two panels of the opened sleeve show.
 *
 * With both inner sleeves photographed, each panel gets its own. A single
 * photo normally sits on its own panel and the other stays blank — unless
 * it is a wide shot of the whole opened sleeve (`soloAspect`, its width /
 * height, once known), which is then split across both panels.
 */
export function innerPanels(
  parts: RecordParts,
  soloAspect: number | null,
): { left: PanelImage | null; right: PanelImage | null } {
  const { innerA, innerB } = parts;
  if (innerA && innerB) {
    return { left: { image: innerA, half: null }, right: { image: innerB, half: null } };
  }
  const solo = innerA ?? innerB;
  if (!solo) return { left: null, right: null };
  if (soloAspect !== null && soloAspect >= SPREAD_ASPECT) {
    return { left: { image: solo, half: 'left' }, right: { image: solo, half: 'right' } };
  }
  return {
    left: innerA ? { image: innerA, half: null } : null,
    right: innerB ? { image: innerB, half: null } : null,
  };
}

/**
 * Where a click on a sleeve face leads.
 *
 * Front: opens the gatefold, or turns straight to the back cover when there
 * are no inner sleeves (and stays put when there is no back cover either).
 * Left inner sleeve: closes. Right inner sleeve: closes and turns to the
 * back cover. Back cover: turns to the front again.
 */
export function viewAfterFaceClick(face: SleeveFace, parts: RecordParts): SleeveView {
  switch (face) {
    case 'front':
      if (parts.hasInner) return 'open';
      return parts.back ? 'back' : 'front';
    case 'inner-b':
      return parts.back ? 'back' : 'front';
    case 'inner-a':
    case 'back':
      return 'front';
  }
}

/** A disc can be turned over only when both of its sides were photographed. */
export function canFlip(disc: RecordDisc): boolean {
  return disc.sideA !== null && disc.sideB !== null;
}

/** The side a disc currently shows, given whether it has been turned over. */
export function shownSide(disc: RecordDisc, flipped: boolean): 'A' | 'B' {
  if (!disc.sideA) return 'B';
  return flipped && disc.sideB ? 'B' : 'A';
}

/** "Side A", or "Disc 2, side B" when the record has several discs. */
export function discSideLabel(disc: RecordDisc, flipped: boolean, discCount: number): string {
  const side = shownSide(disc, flipped);
  return discCount > 1 ? `Disc ${disc.discNumber}, side ${side}` : `Side ${side}`;
}

// Geometry, in units of the sleeve's side. record-viewer.css uses the same numbers.
export const MAX_SLEEVE_PX = 400;
/** Share of the available width the sleeve takes when there is less than MAX_SLEEVE_PX to spare. */
export const SLEEVE_WIDTH_SHARE = 0.62;
/** A disc's diameter. */
export const DISC_SIZE = 0.94;
/** Left edge of the first disc while it peeks out of the sleeve. */
export const PEEK_OFFSET = 0.5;
/** How much further each later disc peeks. */
export const PEEK_STEP = 0.22;
/** Left edge of the first disc once rolled out; each later disc sits one sleeve-width further. */
export const OUT_OFFSET = 1.04;

export interface RecordLayout {
  /** Sleeve side in px, before scaling. */
  size: number;
  /** Shrinks the whole record when the current state is wider than the space. */
  scale: number;
  /** Offset that centres the record horizontally. */
  x: number;
  /** Offset that keeps a scaled-down record vertically centred. */
  y: number;
  /** How far the sleeve shifts right to make room for the opened left panel. */
  slot: number;
}

/** Sizes and centres the record for the space it has and the state it is in. */
export function recordLayout(
  width: number,
  view: SleeveView,
  discsOut: boolean,
  discCount: number,
): RecordLayout {
  const size = Math.min(MAX_SLEEVE_PX, width * SLEEVE_WIDTH_SHARE);
  let needed: number;
  if (view === 'open') needed = 2 * size;
  else if (view === 'back' || discCount === 0) needed = size;
  else if (discsOut) needed = size * (OUT_OFFSET + (discCount - 1) + DISC_SIZE);
  else needed = size * (PEEK_OFFSET + PEEK_STEP * (discCount - 1) + DISC_SIZE);
  const scale = needed > 0 ? Math.min(1, width / needed) : 1;
  return {
    size,
    scale,
    x: (width - needed * scale) / 2,
    y: (size - size * scale) / 2,
    slot: view === 'open' ? size : 0,
  };
}
