import { describe, expect, it } from 'vitest';
import {
  allSteps,
  buildSetupItems,
  makeStep,
  nextPendingIndex,
  selectedSteps,
  slotKey,
  toggleSetupItem,
  withStatus,
} from './scan-session.logic';

describe('makeStep', () => {
  it('labels packaging as sleeve shots', () => {
    expect(makeStep({ kind: 'COVER_BACK', discNumber: 1 }, false)).toEqual({
      kind: 'COVER_BACK',
      discNumber: 1,
      mode: 'sleeve',
      label: 'Cover back',
      shortLabel: 'Back',
    });
  });

  it('only mentions the disc number on multi-disc records', () => {
    expect(makeStep({ kind: 'DISC_SIDE_A', discNumber: 1 }, false).label).toBe('Side A');
    const step = makeStep({ kind: 'DISC_SIDE_B', discNumber: 2 }, true);
    expect(step.mode).toBe('disc');
    expect(step.label).toBe('Disc 2 · Side B');
    expect(step.shortLabel).toBe('2B');
  });
});

describe('allSteps', () => {
  it('lists packaging, then both sides of every disc', () => {
    expect(allSteps(2).map((s) => s.shortLabel)).toEqual([
      'Front',
      'Back',
      'Inner A',
      'Inner B',
      '1A',
      '1B',
      '2A',
      '2B',
    ]);
  });
});

describe('buildSetupItems', () => {
  const filled = new Set(['COVER_FRONT-1', 'DISC_SIDE_A-1']);

  it('pre-selects only the empty slots', () => {
    const items = buildSetupItems(1, filled);
    const selected = selectedSteps(items).map((s) => s.shortLabel);
    expect(selected).toEqual(['Back', 'Inner A', 'Inner B', 'Side B']);
    expect(items.find((i) => i.step.kind === 'COVER_FRONT')!.filled).toBe(true);
  });

  it('keeps the user’s ticks when the disc count changes', () => {
    let items = buildSetupItems(1, filled);
    items = toggleSetupItem(items, 'INNER_SLEEVE_B-1'); // untick
    items = toggleSetupItem(items, 'COVER_FRONT-1'); // re-shoot a filled one
    items = buildSetupItems(2, filled, items);
    const selected = selectedSteps(items).map(slotKey);
    expect(selected).toEqual([
      'COVER_FRONT-1',
      'COVER_BACK-1',
      'INNER_SLEEVE_A-1',
      'DISC_SIDE_B-1',
      'DISC_SIDE_A-2',
      'DISC_SIDE_B-2',
    ]);
    // Labels switch to the multi-disc form.
    expect(items.find((i) => slotKey(i.step) === 'DISC_SIDE_B-1')!.step.label).toBe(
      'Disc 1 · Side B',
    );
  });

  it('drops a removed disc’s rows', () => {
    const items = buildSetupItems(1, filled, buildSetupItems(3, filled));
    expect(items.some((i) => i.step.discNumber > 1)).toBe(false);
  });
});

describe('nextPendingIndex', () => {
  it('moves on to the next pending step', () => {
    expect(nextPendingIndex(['done', 'pending', 'pending'], 0)).toBe(1);
  });

  it('wraps round to an earlier pending step (after jumping ahead)', () => {
    expect(nextPendingIndex(['pending', 'skipped', 'done'], 2)).toBe(0);
  });

  it('returns -1 when nothing is pending', () => {
    expect(nextPendingIndex(['done', 'skipped'], 0)).toBe(-1);
  });
});

describe('withStatus', () => {
  it('replaces one entry', () => {
    expect(withStatus(['pending', 'pending'], 1, 'done')).toEqual(['pending', 'done']);
  });
});
