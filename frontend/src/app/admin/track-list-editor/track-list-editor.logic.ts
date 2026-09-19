import { Artist } from '../../models/vinyl.model';

/**
 * One editable row per track. `dirty`/`overrideArtists` implement the
 * resolved track-artist-override design (see frontend-design-plan.md):
 * pristine (dirty=false) always DISPLAYS the album's current artists as
 * checked but the payload omits `artistIds` (inherits); the first toggle
 * or add on a pristine row promotes it to dirty using that display as the
 * base, after which it's a real, independently-tracked override — even if
 * it ends up matching the album's set again. `serverId` is null for a
 * track that doesn't exist on the backend yet.
 */
export interface TrackFormRow {
  key: string;
  serverId: number | null;
  position: number;
  title: string;
  side: string;
  dirty: boolean;
  overrideArtists: Artist[];
}

export function createEmptyTrackRow(position: number): TrackFormRow {
  return {
    key: crypto.randomUUID(),
    serverId: null,
    position,
    title: '',
    side: '',
    dirty: false,
    overrideArtists: [],
  };
}

/** Artists currently displayed as checked: the override set once dirty, otherwise the album's own artists. */
export function displayedArtists(
  row: Pick<TrackFormRow, 'dirty' | 'overrideArtists'>,
  albumArtists: Artist[],
): Artist[] {
  return row.dirty ? row.overrideArtists : albumArtists;
}

/**
 * Toggles one artist's membership. The first toggle on a pristine row
 * promotes it to dirty using the CURRENT pristine display (the album's
 * artists) as the base for the new override — not an empty set.
 */
export function toggleArtist(row: TrackFormRow, artist: Artist, albumArtists: Artist[]): TrackFormRow {
  const current = displayedArtists(row, albumArtists);
  const isChecked = current.some((a) => a.id === artist.id);
  const next = isChecked ? current.filter((a) => a.id !== artist.id) : [...current, artist];
  return { ...row, dirty: true, overrideArtists: next };
}

/** Adds a new artist (from search or create) not currently displayed. Also promotes pristine -> dirty. */
export function addArtist(row: TrackFormRow, artist: Artist, albumArtists: Artist[]): TrackFormRow {
  const current = displayedArtists(row, albumArtists);
  if (current.some((a) => a.id === artist.id)) return row;
  return { ...row, dirty: true, overrideArtists: [...current, artist] };
}

/** Clears the dirty flag and reverts to pristine (inherit) display. */
export function resetToInherit(row: TrackFormRow): TrackFormRow {
  return { ...row, dirty: false, overrideArtists: [] };
}

/**
 * Builds the tracks-array payload fragment for one row. Omits `artistIds`
 * while pristine so the backend keeps inheriting; sends it once dirty —
 * including the case where the override set happens to equal the album's,
 * per the API's own zero-rows-means-inherit semantics.
 */
export function trackRowToPayload(row: TrackFormRow): {
  position: number;
  title: string;
  side: string | null;
  artistIds?: number[];
} {
  return {
    position: row.position,
    title: row.title.trim(),
    side: row.side.trim() || null,
    ...(row.dirty ? { artistIds: row.overrideArtists.map((a) => a.id) } : {}),
  };
}
