// Minimal shape of the Discogs API responses this app actually reads. Not
// exhaustive — Discogs returns considerably more than this on both
// endpoints; only the fields the import feature uses are typed here. See
// https://www.discogs.com/developers (database/search, /releases/{id}).

export interface DiscogsSearchResult {
  id: number;
  // Discogs's search API returns one combined "Artist - Title" string per
  // result, not separate artist/title fields — see
  // discogs-import-implementation-status.md for why the candidate list
  // passes this through as-is instead of trying to split it.
  title: string;
  year?: number;
  country?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  thumb?: string;
  cover_image?: string;
}

export interface DiscogsSearchResponse {
  results: DiscogsSearchResult[];
}

export interface DiscogsArtistCredit {
  id: number;
  // May carry a trailing " (N)" disambiguator when Discogs has multiple
  // artists with the same name, e.g. "Charles Watson (2)" — stripped by
  // stripDisambiguator() in import.service.ts before ever reaching
  // ArtistsService.
  name: string;
  anv?: string;
  // Only meaningful on a tracklist item's extraartists[] (e.g. "Featuring",
  // "Vocals", "Producer") — absent on a release's/track's own artists[].
  role?: string;
}

export interface DiscogsLabel {
  name: string;
  catno?: string;
}

export interface DiscogsFormat {
  name: string; // e.g. "Vinyl"
  qty?: string;
  descriptions?: string[]; // e.g. ["LP", "Album", "Reissue"], ["7\"", "45 RPM"]
  text?: string;
}

export interface DiscogsTracklistItem {
  position?: string; // e.g. "A1", "B2", "1" (CD-style numbering), ""
  type_?: string; // "track" | "heading" | "index" | undefined (older releases omit it)
  title: string;
  duration?: string;
  // Present only when this track's artist differs from the release's own —
  // absence means "inherits", matching this app's own zero-rows semantics.
  artists?: DiscogsArtistCredit[];
  // Additional per-track credits Discogs tracks separately from `artists`
  // (each with a `role`, e.g. "Featuring", "Vocals", "Producer", "Mixed
  // By") — this is where guest/featuring credits usually live when the
  // track's own `artists` is empty. See discogs-track-parser.ts for which
  // roles get folded into the track's artist override.
  extraartists?: DiscogsArtistCredit[];
  sub_tracks?: DiscogsTracklistItem[];
}

export interface DiscogsImage {
  type?: 'primary' | 'secondary';
  uri: string;
  uri150?: string;
  width?: number;
  height?: number;
}

export interface DiscogsRelease {
  id: number;
  title: string;
  year?: number;
  artists?: DiscogsArtistCredit[];
  labels?: DiscogsLabel[];
  formats?: DiscogsFormat[];
  genres?: string[];
  styles?: string[];
  tracklist?: DiscogsTracklistItem[];
  images?: DiscogsImage[];
}
