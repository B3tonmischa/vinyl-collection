import { DiscSize, ReleaseType, Speed } from '../../generated/prisma/enums';

export interface MappedFormat {
  releaseType: ReleaseType | null;
  discSize: DiscSize | null;
  speed: Speed | null;
}

/**
 * Best-effort mapping from Discogs's freeform `formats[].descriptions`
 * strings (e.g. "LP", "Album", "7\"", "33 ⅓ RPM", "Compilation") onto the
 * app's own three independent enums. Discogs doesn't structure these
 * consistently across releases, so a description that doesn't confidently
 * match anything here is simply left out — the admin fills the gap in
 * manually, same as for a fully manual entry. This table isn't exhaustive;
 * extend it as real-world imports turn up format strings it misses (see
 * discogs-import-implementation-status.md open item).
 */
const RELEASE_TYPE_MAP: Record<string, ReleaseType> = {
  lp: ReleaseType.LP,
  album: ReleaseType.LP,
  ep: ReleaseType.EP,
  single: ReleaseType.SINGLE,
  maxi: ReleaseType.SINGLE,
  'maxi-single': ReleaseType.SINGLE,
  compilation: ReleaseType.COMPILATION,
  'box set': ReleaseType.BOX_SET,
  boxed: ReleaseType.BOX_SET,
};

const DISC_SIZE_MAP: Record<string, DiscSize> = {
  '7"': DiscSize.SEVEN_INCH,
  '7 inch': DiscSize.SEVEN_INCH,
  '10"': DiscSize.TEN_INCH,
  '10 inch': DiscSize.TEN_INCH,
  '12"': DiscSize.TWELVE_INCH,
  '12 inch': DiscSize.TWELVE_INCH,
};

const SPEED_MAP: Record<string, Speed> = {
  '33 rpm': Speed.RPM_33,
  '33': Speed.RPM_33,
  '45 rpm': Speed.RPM_45,
  '45': Speed.RPM_45,
  '78 rpm': Speed.RPM_78,
  '78': Speed.RPM_78,
};

// Lowercases, collapses the "⅓"/"1/3" fraction glyphs that Discogs sometimes
// appends to "33" (so "33 ⅓ RPM", "33 1/3 RPM", and "33 RPM" all resolve to
// the same lookup key), and normalizes whitespace.
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/⅓/g, '')
    .replace(/1\/3/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapDiscogsFormats(formats: { descriptions?: string[] }[]): MappedFormat {
  const descriptions = formats.flatMap((f) => f.descriptions ?? []).map(normalize);

  let releaseType: ReleaseType | null = null;
  let discSize: DiscSize | null = null;
  let speed: Speed | null = null;

  for (const desc of descriptions) {
    if (!releaseType && RELEASE_TYPE_MAP[desc]) releaseType = RELEASE_TYPE_MAP[desc];
    if (!discSize && DISC_SIZE_MAP[desc]) discSize = DISC_SIZE_MAP[desc];
    if (!speed && SPEED_MAP[desc]) speed = SPEED_MAP[desc];
  }

  return { releaseType, discSize, speed };
}
