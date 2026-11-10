// Pure model for a camera scan session: which photos to take (the setup
// screen of a guided "Scan record"), their labels, and per-step status for
// the progress strip. Kept free of Angular/DOM so it's unit-testable.

import { DISC_IMAGE_KINDS, ImageKind, PACKAGING_IMAGE_KINDS } from '../../models/vinyl.model';
import { SQUARE_ONLY, SQUARE_OR_SPREAD } from './camera-capture.logic';

export type CaptureMode = 'sleeve' | 'disc';

/** One photo slot of a record: an image kind + disc number. */
export interface ScanSlot {
  kind: ImageKind;
  discNumber: number;
}

export interface ScanStep extends ScanSlot {
  mode: CaptureMode;
  /** Full name, e.g. "Disc 2 · Side A". */
  label: string;
  /** Fits a progress-strip chip, e.g. "2A". */
  shortLabel: string;
}

export type StepStatus = 'pending' | 'done' | 'skipped';

/** A row on the setup screen. */
export interface SetupItem {
  step: ScanStep;
  /** The slot already has an image (re-shooting replaces it). */
  filled: boolean;
  selected: boolean;
}

const PACKAGING_LABELS: Partial<Record<ImageKind, [label: string, short: string]>> = {
  COVER_FRONT: ['Cover front', 'Front'],
  COVER_BACK: ['Cover back', 'Back'],
  INNER_SLEEVE_A: ['Inner sleeve A', 'Inner A'],
  INNER_SLEEVE_B: ['Inner sleeve B', 'Inner B'],
};

export const MAX_DISCS = 10;

/**
 * Shapes a sleeve photo of this kind can have. A gatefold's inside is one
 * picture across both halves, so the inner sleeve slots also take the
 * opened sleeve in a single shot; the viewer spreads a lone wide photo
 * across both panels (innerPanels in record-viewer.logic.ts).
 */
export function sleeveShapes(kind: ImageKind): readonly number[] {
  return kind === 'INNER_SLEEVE_A' || kind === 'INNER_SLEEVE_B' ? SQUARE_OR_SPREAD : SQUARE_ONLY;
}

/**
 * Discs needed to hold a release's track sides: A/B on disc 1, C/D on
 * disc 2, and so on. Only single-letter sides count; anything else (e.g. a
 * single's "AA") says nothing about the disc count.
 */
export function discCountForSides(sides: readonly string[]): number {
  let count = 1;
  for (const side of sides) {
    const letter = side.trim().toUpperCase();
    if (!/^[A-Z]$/.test(letter)) continue;
    count = Math.max(count, Math.floor((letter.charCodeAt(0) - 65) / 2) + 1);
  }
  return Math.min(count, MAX_DISCS);
}

export function slotKey(slot: ScanSlot): string {
  return `${slot.kind}-${slot.discNumber}`;
}

/** "A" or "B" for a disc-side kind. */
export function discSide(kind: ImageKind): 'A' | 'B' {
  return kind === 'DISC_SIDE_A' ? 'A' : 'B';
}

/**
 * Builds the step for a slot. Disc sides only mention the disc number
 * when the record has more than one disc ("Side A" vs "Disc 2 · Side A").
 */
export function makeStep(slot: ScanSlot, multiDisc: boolean): ScanStep {
  if (!DISC_IMAGE_KINDS.includes(slot.kind)) {
    const [label, shortLabel] = PACKAGING_LABELS[slot.kind] ?? [slot.kind, slot.kind];
    return { ...slot, mode: 'sleeve', label, shortLabel };
  }
  const side = discSide(slot.kind);
  return {
    ...slot,
    mode: 'disc',
    label: multiDisc ? `Disc ${slot.discNumber} · Side ${side}` : `Side ${side}`,
    shortLabel: multiDisc ? `${slot.discNumber}${side}` : `Side ${side}`,
  };
}

/** The packaging slots of a record (always one of each). */
export function packagingSteps(): ScanStep[] {
  return PACKAGING_IMAGE_KINDS.map((kind) => makeStep({ kind, discNumber: 1 }, false));
}

/** Both sides of every disc of a record with `discCount` discs. */
export function discSteps(discCount: number): ScanStep[] {
  const multi = discCount > 1;
  const steps: ScanStep[] = [];
  for (let disc = 1; disc <= discCount; disc++) {
    for (const kind of DISC_IMAGE_KINDS) steps.push(makeStep({ kind, discNumber: disc }, multi));
  }
  return steps;
}

/** Every slot of a record with `discCount` discs: packaging, then each disc's sides. */
export function allSteps(discCount: number): ScanStep[] {
  return [...packagingSteps(), ...discSteps(discCount)];
}

/**
 * Setup rows for `discCount` discs. Empty slots start selected, filled
 * ones don't (ticking one re-shoots it). When the disc count changes,
 * pass the previous rows so the user's ticks survive.
 */
export function buildSetupItems(
  discCount: number,
  filledKeys: ReadonlySet<string>,
  previous: SetupItem[] = [],
): SetupItem[] {
  const prior = new Map(previous.map((item) => [slotKey(item.step), item.selected]));
  return allSteps(discCount).map((step) => {
    const key = slotKey(step);
    const filled = filledKeys.has(key);
    return { step, filled, selected: prior.get(key) ?? !filled };
  });
}

export function toggleSetupItem(items: SetupItem[], key: string): SetupItem[] {
  return items.map((item) =>
    slotKey(item.step) === key ? { ...item, selected: !item.selected } : item,
  );
}

export function selectedSteps(items: SetupItem[]): ScanStep[] {
  return items.filter((item) => item.selected).map((item) => item.step);
}

/**
 * The step to go to after `current`: the next still-pending one, wrapping
 * round to earlier skipped-over pending steps; -1 when nothing is left.
 */
export function nextPendingIndex(statuses: StepStatus[], current: number): number {
  const n = statuses.length;
  for (let i = 1; i <= n; i++) {
    const idx = (current + i) % n;
    if (statuses[idx] === 'pending') return idx;
  }
  return -1;
}

export function withStatus(
  statuses: StepStatus[],
  index: number,
  status: StepStatus,
): StepStatus[] {
  return statuses.map((s, i) => (i === index ? status : s));
}
