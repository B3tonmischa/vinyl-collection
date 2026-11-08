import { describe, expect, it } from 'vitest';
import { Artist } from '../../models/vinyl.model';
import {
  addArtist,
  createEmptyTrackRow,
  displayedArtists,
  knownSides,
  nextSide,
  resetToInherit,
  sideForNewRow,
  toggleArtist,
  trackRowToPayload,
} from './track-list-editor.logic';

const artistA: Artist = { id: 1, name: 'Artist A' };
const artistB: Artist = { id: 2, name: 'Artist B' };
const artistC: Artist = { id: 3, name: 'Artist C' };
const albumArtists: Artist[] = [artistA, artistB];

describe('createEmptyTrackRow', () => {
  it('creates a pristine row with no server id and no override artists', () => {
    const row = createEmptyTrackRow(3);
    expect(row.serverId).toBeNull();
    expect(row.position).toBe(3);
    expect(row.title).toBe('');
    expect(row.side).toBe('');
    expect(row.dirty).toBe(false);
    expect(row.overrideArtists).toEqual([]);
  });

  it('assigns a unique key to each row', () => {
    const a = createEmptyTrackRow(1);
    const b = createEmptyTrackRow(1);
    expect(a.key).not.toBe(b.key);
  });
});

describe('displayedArtists', () => {
  it('shows the album artists while pristine', () => {
    const row = { dirty: false, overrideArtists: [] };
    expect(displayedArtists(row, albumArtists)).toEqual(albumArtists);
  });

  it('shows the stored override once dirty, ignoring the album artists', () => {
    const row = { dirty: true, overrideArtists: [artistC] };
    expect(displayedArtists(row, albumArtists)).toEqual([artistC]);
  });
});

describe('toggleArtist', () => {
  it('promotes a pristine row to dirty, using the album artists as the base', () => {
    const pristine = createEmptyTrackRow(1);
    // Unchecking one of the two album artists on a pristine row should
    // result in an override of just the other one, not an empty set.
    const next = toggleArtist(pristine, artistA, albumArtists);
    expect(next.dirty).toBe(true);
    expect(next.overrideArtists).toEqual([artistB]);
  });

  it('adding a guest artist on a pristine row keeps the album artists plus the guest', () => {
    const pristine = createEmptyTrackRow(1);
    const next = toggleArtist(pristine, artistC, albumArtists);
    expect(next.dirty).toBe(true);
    expect(next.overrideArtists).toEqual([artistA, artistB, artistC]);
  });

  it('toggles off an already-dirty override artist', () => {
    const dirty = { ...createEmptyTrackRow(1), dirty: true, overrideArtists: [artistA, artistC] };
    const next = toggleArtist(dirty, artistC, albumArtists);
    expect(next.dirty).toBe(true);
    expect(next.overrideArtists).toEqual([artistA]);
  });

  it('toggling back to exactly the album set still stays dirty (independent override)', () => {
    const pristine = createEmptyTrackRow(1);
    // Remove then re-add artistA: ends up matching albumArtists again, but
    // the row must remain a real, independently-tracked override.
    const removed = toggleArtist(pristine, artistA, albumArtists);
    const readded = toggleArtist(removed, artistA, albumArtists);
    expect(readded.dirty).toBe(true);
    expect(readded.overrideArtists).toEqual([artistB, artistA]);
  });

  it('does not mutate the original row', () => {
    const pristine = createEmptyTrackRow(1);
    toggleArtist(pristine, artistA, albumArtists);
    expect(pristine.dirty).toBe(false);
    expect(pristine.overrideArtists).toEqual([]);
  });
});

describe('addArtist', () => {
  it('adds a new artist on a pristine row, promoting it to dirty', () => {
    const pristine = createEmptyTrackRow(1);
    const next = addArtist(pristine, artistC, albumArtists);
    expect(next.dirty).toBe(true);
    expect(next.overrideArtists).toEqual([artistA, artistB, artistC]);
  });

  it('is a no-op if the artist is already displayed', () => {
    const pristine = createEmptyTrackRow(1);
    const next = addArtist(pristine, artistA, albumArtists);
    expect(next).toBe(pristine);
  });

  it('is a no-op if the artist is already in an existing override', () => {
    const dirty = { ...createEmptyTrackRow(1), dirty: true, overrideArtists: [artistC] };
    const next = addArtist(dirty, artistC, albumArtists);
    expect(next).toBe(dirty);
  });
});

describe('resetToInherit', () => {
  it('clears dirty and the override set, reverting to pristine display', () => {
    const dirty = { ...createEmptyTrackRow(1), dirty: true, overrideArtists: [artistC] };
    const next = resetToInherit(dirty);
    expect(next.dirty).toBe(false);
    expect(next.overrideArtists).toEqual([]);
    expect(displayedArtists(next, albumArtists)).toEqual(albumArtists);
  });
});

describe('trackRowToPayload', () => {
  it('omits artistIds for a pristine row (inherits the album artists)', () => {
    const row = { ...createEmptyTrackRow(2), title: '  Track Title  ', side: ' A ' };
    const payload = trackRowToPayload(row);
    expect(payload).toEqual({ position: 2, title: 'Track Title', side: 'A' });
    expect(payload).not.toHaveProperty('artistIds');
  });

  it('sends artistIds once dirty, even when the set matches the album artists', () => {
    const row = { ...createEmptyTrackRow(2), dirty: true, overrideArtists: [artistB, artistA] };
    const payload = trackRowToPayload(row);
    expect(payload.artistIds).toEqual([2, 1]);
  });

  it('sends an empty artistIds array for a dirty row with no artists at all', () => {
    const row = { ...createEmptyTrackRow(2), dirty: true, overrideArtists: [] };
    const payload = trackRowToPayload(row);
    expect(payload.artistIds).toEqual([]);
  });

  it('normalizes a blank side to null', () => {
    const row = { ...createEmptyTrackRow(1), side: '   ' };
    const payload = trackRowToPayload(row);
    expect(payload.side).toBeNull();
  });
});

const rowsWithSides = (...sides: string[]) => sides.map((side) => ({ side }));

describe('createEmptyTrackRow side', () => {
  it('starts on the given side', () => {
    expect(createEmptyTrackRow(3, 'C').side).toBe('C');
  });
});

describe('knownSides', () => {
  it('always offers A and B', () => {
    expect(knownSides([])).toEqual(['A', 'B']);
  });

  it('adds the sides rows use and the added ones, without blanks or duplicates', () => {
    expect(knownSides(rowsWithSides('A', ' D ', '', 'C'), ['E', 'C'])).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  it('keeps odd values so their rows are not blanked, after the letters', () => {
    expect(knownSides(rowsWithSides('AA', 'B'))).toEqual(['A', 'B', 'AA']);
  });
});

describe('nextSide', () => {
  it('is the letter after the last single-letter side', () => {
    expect(nextSide(['A', 'B'])).toBe('C');
    expect(nextSide(['A', 'B', 'AA', 'D'])).toBe('E');
  });

  it('starts at A when there are no letters', () => {
    expect(nextSide([])).toBe('A');
  });

  it('is null once Z is taken', () => {
    expect(nextSide(['Z'])).toBeNull();
  });
});

describe('sideForNewRow', () => {
  it('prefers the side last picked on any row', () => {
    expect(sideForNewRow('B', rowsWithSides('A', 'C'), ['A', 'B', 'C'])).toBe('B');
  });

  it("falls back to the last row's side", () => {
    expect(sideForNewRow(null, rowsWithSides('A', 'C'), ['A', 'B', 'C'])).toBe('C');
  });

  it('falls back to the first side for an empty or side-less tracklist', () => {
    expect(sideForNewRow(null, [], ['A', 'B'])).toBe('A');
    expect(sideForNewRow(null, rowsWithSides(''), ['A', 'B'])).toBe('A');
  });
});
