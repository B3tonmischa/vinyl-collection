// Types for the Discogs import feature (backend/src/import).

export interface DiscogsSearchCandidate {
  discogsReleaseId: number;
  /** Discogs's own combined "Artist – Title" search-result string — its search API doesn't return separate artist/title fields. */
  title: string;
  year: number | null;
  formats: string[];
  country: string | null;
  catalogNumber: string | null;
  label: string | null;
  thumbnailUrl: string | null;
}

export interface DiscogsSearchQuery {
  barcode?: string;
  catno?: string;
  artist?: string;
  title?: string;
}
