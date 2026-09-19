// Data model matching the backend API contract exactly.
// See project doc `architecture-and-data-model.md` for the source of truth.

export type ReleaseType = 'LP' | 'EP' | 'SINGLE' | 'COMPILATION' | 'BOX_SET';
export type DiscSize = 'SEVEN_INCH' | 'TEN_INCH' | 'TWELVE_INCH';
export type Speed = 'RPM_33' | 'RPM_45' | 'RPM_78';
export type ImageKind =
  | 'COVER_FRONT'
  | 'COVER_BACK'
  | 'INNER_SLEEVE'
  | 'DISC_SIDE_A'
  | 'DISC_SIDE_B';

export const RELEASE_TYPES: ReleaseType[] = ['LP', 'EP', 'SINGLE', 'COMPILATION', 'BOX_SET'];
export const DISC_SIZES: DiscSize[] = ['SEVEN_INCH', 'TEN_INCH', 'TWELVE_INCH'];
export const SPEEDS: Speed[] = ['RPM_33', 'RPM_45', 'RPM_78'];

export interface Artist {
  id: number;
  name: string;
}

export interface Track {
  id: number;
  position: number;
  title: string;
  side: string | null;
  /** Raw override rows — empty means this track inherits the vinyl's artists. */
  artists: Artist[];
  /** Computed: `artists` when non-empty, otherwise the vinyl's own artists. */
  effectiveArtists: Artist[];
}

export interface VinylImage {
  id: number;
  kind: ImageKind;
  discNumber: number;
  fullPath: string;
  thumbPath: string;
}

export interface Vinyl {
  id: number;
  title: string;
  year: number | null;
  label: string | null;
  catalogNumber: string | null;
  releaseType: ReleaseType | null;
  discSize: DiscSize | null;
  speed: Speed | null;
  genre: string | null;
  notes: string | null;
  artists: Artist[];
  tracks: Track[];
  images: VinylImage[];
}

/** Body shape for POST/PATCH /vinyls/:id. */
export interface VinylPayload {
  title: string;
  year?: number | null;
  label?: string | null;
  catalogNumber?: string | null;
  releaseType?: ReleaseType | null;
  discSize?: DiscSize | null;
  speed?: Speed | null;
  genre?: string | null;
  notes?: string | null;
  /** Omitting leaves existing artists alone (on update); providing replaces the set fully. */
  artistIds?: number[];
  /** Omitting leaves existing tracks alone (on update); providing replaces the set fully. */
  tracks?: TrackPayload[];
}

export interface TrackPayload {
  position: number;
  title: string;
  side?: string | null;
  /** Omit = inherit the vinyl's artists. Present (even if empty array is NOT valid — see form logic) = override. */
  artistIds?: number[];
}

/** kind path segments used in upload/delete/restore image endpoints. */
export const IMAGE_KIND_SLUGS: Record<ImageKind, string> = {
  COVER_FRONT: 'cover-front',
  COVER_BACK: 'cover-back',
  INNER_SLEEVE: 'inner-sleeve',
  DISC_SIDE_A: 'disc-side-a',
  DISC_SIDE_B: 'disc-side-b',
};

export const PACKAGING_IMAGE_KINDS: ImageKind[] = ['COVER_FRONT', 'COVER_BACK', 'INNER_SLEEVE'];
export const DISC_IMAGE_KINDS: ImageKind[] = ['DISC_SIDE_A', 'DISC_SIDE_B'];

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  LP: 'LP',
  EP: 'EP',
  SINGLE: 'Single',
  COMPILATION: 'Compilation',
  BOX_SET: 'Box Set',
};

export const DISC_SIZE_LABELS: Record<DiscSize, string> = {
  SEVEN_INCH: '7"',
  TEN_INCH: '10"',
  TWELVE_INCH: '12"',
};

export const SPEED_LABELS: Record<Speed, string> = {
  RPM_33: '33⅓ RPM',
  RPM_45: '45 RPM',
  RPM_78: '78 RPM',
};
