// Pure display rule extracted from TracklistComponent so it can be
// unit-tested without instantiating the component.

import { Artist, ReleaseType } from '../../models/vinyl.model';

function artistIds(artists: Artist[]): Set<number> {
  return new Set(artists.map((a) => a.id));
}

/** True when both lists hold the same artists, compared by id in any order. */
function sameArtists(a: Artist[], b: Artist[]): boolean {
  const idsA = artistIds(a);
  const idsB = artistIds(b);
  return idsA.size === idsB.size && [...idsA].every((id) => idsB.has(id));
}

/**
 * Whether a track shows its artists on the detail page.
 *
 * Multi-artist albums and compilations show them on every track, since the
 * album credit doesn't say who is on which track. Single-artist albums only
 * show them when the track's artists differ from the album's (a guest or a
 * different artist). A track with no artists has nothing to show.
 */
export function showsTrackArtists(
  effectiveArtists: Artist[],
  albumArtists: Artist[],
  releaseType: ReleaseType | null,
): boolean {
  if (effectiveArtists.length === 0) return false;
  if (releaseType === 'COMPILATION' || artistIds(albumArtists).size > 1) return true;
  return !sameArtists(effectiveArtists, albumArtists);
}
