import { describe, expect, it } from 'vitest';
import { Artist } from '../../models/vinyl.model';
import { showsTrackArtists } from './tracklist.logic';

const alice: Artist = { id: 1, name: 'Alice' };
const bob: Artist = { id: 2, name: 'Bob' };
const carol: Artist = { id: 3, name: 'Carol' };

describe('showsTrackArtists', () => {
  describe('single-artist album', () => {
    it('hides the artist on a track that inherits the album artist', () => {
      expect(showsTrackArtists([alice], [alice], 'LP')).toBe(false);
    });

    it('hides the artist when the release type is unknown', () => {
      expect(showsTrackArtists([alice], [alice], null)).toBe(false);
    });

    it('hides an explicit override that matches the album artist', () => {
      expect(showsTrackArtists([{ id: 1, name: 'Alice (renamed)' }], [alice], 'LP')).toBe(false);
    });

    it('shows a track with a guest artist', () => {
      expect(showsTrackArtists([alice, bob], [alice], 'LP')).toBe(true);
    });

    it('shows a track by a different artist', () => {
      expect(showsTrackArtists([bob], [alice], 'LP')).toBe(true);
    });

    it('ignores a duplicated artist on the track', () => {
      expect(showsTrackArtists([alice, alice], [alice], 'LP')).toBe(false);
    });
  });

  describe('multi-artist album', () => {
    it('shows a track that inherits the album artists', () => {
      expect(showsTrackArtists([alice, bob], [alice, bob], 'LP')).toBe(true);
    });

    it('shows a track with only one of the album artists', () => {
      expect(showsTrackArtists([bob], [alice, bob], 'LP')).toBe(true);
    });

    it('shows a track with the album artists in a different order', () => {
      expect(showsTrackArtists([bob, alice], [alice, bob], 'LP')).toBe(true);
    });

    it('treats a duplicated album artist as a single artist', () => {
      expect(showsTrackArtists([alice], [alice, alice], 'LP')).toBe(false);
    });
  });

  describe('compilation', () => {
    it('shows a track that inherits a single album artist', () => {
      expect(showsTrackArtists([alice], [alice], 'COMPILATION')).toBe(true);
    });

    it('shows a track with its own artist', () => {
      expect(showsTrackArtists([carol], [alice], 'COMPILATION')).toBe(true);
    });

    it('shows a track when the album has no artists', () => {
      expect(showsTrackArtists([carol], [], 'COMPILATION')).toBe(true);
    });
  });

  it('hides a track with no artists, whatever the album', () => {
    expect(showsTrackArtists([], [], 'LP')).toBe(false);
    expect(showsTrackArtists([], [], 'COMPILATION')).toBe(false);
    expect(showsTrackArtists([], [alice, bob], 'LP')).toBe(false);
  });
});
