export interface ParsedDiscogsTrack {
  /** Sequential running order among the tracks actually imported (1-based) — NOT derived from the printed Discogs position; see side below for that. */
  position: number;
  title: string;
  /** The leading letter run of the printed Discogs position (e.g. "A" from "A3a"), or null if the position has none (e.g. CD-style "1"). */
  side: string | null;
  /** null = inherits the release's own artists; a non-empty array = this track has its own Discogs-credited artist(s), to be resolved and compared against the album's own. */
  artistNames: string[] | null;
}

interface DiscogsTracklistItemLike {
  position?: string;
  type_?: string;
  title: string;
  artists?: { name: string; id?: number }[];
  sub_tracks?: DiscogsTracklistItemLike[];
}

function extractSide(position: string | undefined): string | null {
  const match = (position ?? '').match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : null;
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

  return flat.map((item, index) => ({
    position: index + 1,
    title: item.title,
    side: extractSide(item.position),
    artistNames: item.artists?.length ? item.artists.map((a) => a.name) : null,
  }));
}
