export interface ParsedDiscogsTrack {
  /** Sequential running order among the tracks actually imported (1-based) — NOT derived from the printed Discogs position; see side below for that. */
  position: number;
  title: string;
  /** The leading letter run of the printed Discogs position (e.g. "A" from "A3a"), or null if the position has none (e.g. CD-style "1"). */
  side: string | null;
  /** null = inherits the release's own artists; a non-empty array = this track has its own Discogs-credited artist(s), to be resolved and compared against the album's own. */
  artistNames: string[] | null;
  /** null = no featuring/guest-vocal-type extraartists credit; a non-empty array = names pulled from this track's extraartists[] whose role looks like a featuring/guest-vocal credit (see isFeaturingRole below). Kept separate from artistNames since, unlike a track's own artists[], Discogs often leaves artists[] empty for a featuring credit — the caller decides how to combine the two with the album's own artists. */
  featuringArtistNames: string[] | null;
}

interface DiscogsTracklistItemLike {
  position?: string;
  type_?: string;
  title: string;
  artists?: { name: string; id?: number }[];
  extraartists?: { name: string; id?: number; role?: string }[];
  sub_tracks?: DiscogsTracklistItemLike[];
}

function extractSide(position: string | undefined): string | null {
  const match = (position ?? '').match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : null;
}

// Discogs's extraartists roles are freeform credit labels (e.g.
// "Featuring", "Vocals", "Guest Vocals", "Producer", "Mixed By", "Written-
// By"). Only the performing/guest-vocal-type ones represent a real
// featuring credit worth folding into a track's artist override — the rest
// (production/writing credits) are explicitly out of scope per KAN-13.
const FEATURING_ROLE_PATTERN = /featuring|vocals/i;

function isFeaturingRole(role: string | undefined): boolean {
  return FEATURING_ROLE_PATTERN.test(role ?? '');
}

/**
 * Flattens a Discogs tracklist into the app's own track shape. Discogs
 * tracklists can mix real tracks with non-track "heading"/"index" rows
 * (section labels with no audio of their own, e.g. "Side A" as its own
 * entry) and can nest genuine sub-tracks (e.g. "A3a", "A3b") inside such a
 * heading via `sub_tracks`. Both are handled the same way: recurse into
 * `sub_tracks` when present, and only keep an item as an importable track
 * when it has a title and its `type_` is either absent (older/smaller
 * releases often omit it) or exactly `"track"` — a `"heading"`/`"index"`
 * row is dropped rather than imported as a spurious track (see
 * discogs-import-feature-plan.md's backend design section).
 */
export function parseDiscogsTracklist(
  tracklist: DiscogsTracklistItemLike[],
): ParsedDiscogsTrack[] {
  const flat: DiscogsTracklistItemLike[] = [];

  function visit(items: DiscogsTracklistItemLike[]): void {
    for (const item of items) {
      const isRealTrack = !item.type_ || item.type_ === 'track';
      if (isRealTrack && item.title) {
        flat.push(item);
      }
      if (item.sub_tracks?.length) {
        visit(item.sub_tracks);
      }
    }
  }
  visit(tracklist ?? []);

  return flat.map((item, index) => {
    const featuringArtistNames =
      item.extraartists?.filter((a) => isFeaturingRole(a.role)).map((a) => a.name) ?? [];
    return {
      position: index + 1,
      title: item.title,
      side: extractSide(item.position),
      artistNames: item.artists?.length ? item.artists.map((a) => a.name) : null,
      featuringArtistNames: featuringArtistNames.length ? featuringArtistNames : null,
    };
  });
}
