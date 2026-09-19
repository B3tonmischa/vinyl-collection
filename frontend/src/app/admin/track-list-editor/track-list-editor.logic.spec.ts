import { describe, expect, it } from 'vitest';
import { Artist } from '../../models/vinyl.model';
import {
  addArtist,
  createEmptyTrackRow,
  displayedArtists,
  resetToInherit,
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
