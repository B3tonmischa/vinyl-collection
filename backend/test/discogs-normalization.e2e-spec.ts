// Named *.e2e-spec.ts to match this project's jest-e2e.json testRegex
// (test/.*\.e2e-spec\.ts$), but these are plain pure-function unit tests —
// no app, no database, no network — for the two normalization helpers
// under src/import/. Kept separate from import.e2e-spec.ts (which does
// spin up a full app) so these stay fast and are the natural place to
// extend if the format-mapping table or track-parsing rules need more
// cases later, per the project's existing "extend the pure-function specs,
// don't re-test through the component/controller" pattern
// (frontend-implementation-status.md's track-list-editor.logic note).
import { mapDiscogsFormats } from '../src/import/discogs-format-mapping';
import { parseDiscogsTracklist } from '../src/import/discogs-track-parser';

describe('mapDiscogsFormats', () => {
  it('maps a clean LP/12"/33RPM description set', () => {
    expect(
      mapDiscogsFormats([{ descriptions: ['LP', 'Album', '12"', '33 ⅓ RPM'] }]),
    ).toEqual({ releaseType: 'LP', discSize: 'TWELVE_INCH', speed: 'RPM_33' });
  });

  it('maps a 7" single at 45 RPM', () => {
    expect(mapDiscogsFormats([{ descriptions: ['7"', '45 RPM', 'Single'] }])).toEqual({
      releaseType: 'SINGLE',
      discSize: 'SEVEN_INCH',
      speed: 'RPM_45',
    });
  });

  it('leaves a field null rather than guessing when nothing confidently matches', () => {
    expect(
      mapDiscogsFormats([{ descriptions: ['Limited Edition', 'Gatefold', 'Club Edition'] }]),
    ).toEqual({ releaseType: null, discSize: null, speed: null });
  });

  it('handles an empty/missing formats array', () => {
    expect(mapDiscogsFormats([])).toEqual({ releaseType: null, discSize: null, speed: null });
  });

  it('is case- and spacing-insensitive', () => {
    expect(mapDiscogsFormats([{ descriptions: ['lp', '  33  RPM  '] }])).toEqual({
      releaseType: 'LP',
      discSize: null,
      speed: 'RPM_33',
    });
  });
});

describe('parseDiscogsTracklist', () => {
  it('splits position into side + a sequential running-order position', () => {
    const result = parseDiscogsTracklist([
      { position: 'A1', title: 'Speak to Me' },
      { position: 'A2', title: 'Breathe' },
      { position: 'B1', title: 'Money' },
    ]);
    expect(result).toEqual([
      { position: 1, title: 'Speak to Me', side: 'A', artistNames: null, featuringArtistNames: null },
      { position: 2, title: 'Breathe', side: 'A', artistNames: null, featuringArtistNames: null },
      { position: 3, title: 'Money', side: 'B', artistNames: null, featuringArtistNames: null },
    ]);
  });

  it('drops a non-track heading/index row entirely', () => {
    const result = parseDiscogsTracklist([
      { position: '', type_: 'heading', title: 'Side A' },
      { position: 'A1', type_: 'track', title: 'Intro' },
    ]);
    expect(result).toEqual([
      { position: 1, title: 'Intro', side: 'A', artistNames: null, featuringArtistNames: null },
    ]);
  });

  it('flattens sub_tracks nested under a heading, using the running order across the whole flattened list', () => {
    const result = parseDiscogsTracklist([
      {
        position: '',
        type_: 'heading',
        title: 'Medley',
        sub_tracks: [
          { position: 'A3a', title: 'Part 1' },
          { position: 'A3b', title: 'Part 2' },
        ],
      },
      { position: 'A4', title: 'Next Track' },
    ]);
    expect(result).toEqual([
      { position: 1, title: 'Part 1', side: 'A', artistNames: null, featuringArtistNames: null },
      { position: 2, title: 'Part 2', side: 'A', artistNames: null, featuringArtistNames: null },
      {
        position: 3,
        title: 'Next Track',
        side: 'A',
        artistNames: null,
        featuringArtistNames: null,
      },
    ]);
  });

  it('treats an item with no type_ at all as a real track (older/smaller releases often omit it)', () => {
    const result = parseDiscogsTracklist([{ position: '1', title: 'Only Track' }]);
    expect(result).toEqual([
      { position: 1, title: 'Only Track', side: null, artistNames: null, featuringArtistNames: null },
    ]);
  });

  it('captures per-track artist credits as artistNames, distinct from the inherit-by-default null', () => {
    const result = parseDiscogsTracklist([
      { position: 'A1', title: 'Solo Track', artists: [{ id: 1, name: 'Guest Artist' }] },
      { position: 'A2', title: 'Album Track' },
    ]);
    expect(result[0].artistNames).toEqual(['Guest Artist']);
    expect(result[1].artistNames).toBeNull();
  });

  it('returns an empty list for an empty/missing tracklist', () => {
    expect(parseDiscogsTracklist([])).toEqual([]);
  });

  it('captures a "Featuring" extraartists credit as featuringArtistNames even when artists[] is empty', () => {
    const result = parseDiscogsTracklist([
      {
        position: 'A2',
        title: 'Love Of My Life',
        extraartists: [{ id: 9, name: 'Dave Matthews', role: 'Featuring' }],
      },
    ]);
    expect(result[0].artistNames).toBeNull();
    expect(result[0].featuringArtistNames).toEqual(['Dave Matthews']);
  });

  it('captures a "Vocals" extraartists credit as featuringArtistNames', () => {
    const result = parseDiscogsTracklist([
      {
        position: 'B1',
        title: 'Smooth',
        extraartists: [{ id: 10, name: 'Rob Thomas', role: 'Vocals' }],
      },
    ]);
    expect(result[0].featuringArtistNames).toEqual(['Rob Thomas']);
  });

  it('collects multiple featuring-like extraartists credits on one track', () => {
    const result = parseDiscogsTracklist([
      {
        position: 'B2',
        title: 'Do You Like The Way',
        extraartists: [
          { id: 11, name: 'Cee-Lo', role: 'Featuring' },
          { id: 12, name: 'Lauryn Hill', role: 'Featuring' },
        ],
      },
    ]);
    expect(result[0].featuringArtistNames).toEqual(['Cee-Lo', 'Lauryn Hill']);
  });

  it('excludes non-performing extraartists roles like Producer or Mixed By', () => {
    const result = parseDiscogsTracklist([
      {
        position: 'A1',
        title: 'No Guests',
        extraartists: [
          { id: 13, name: 'Some Producer', role: 'Producer' },
          { id: 14, name: 'Some Engineer', role: 'Mixed By' },
        ],
      },
    ]);
    expect(result[0].featuringArtistNames).toBeNull();
  });

  it('leaves featuringArtistNames null when extraartists is absent', () => {
    const result = parseDiscogsTracklist([{ position: 'A1', title: 'Plain Track' }]);
    expect(result[0].featuringArtistNames).toBeNull();
  });
});
