// How the detail page takes its colour from a record's front cover: find
// the cover's dominant colour, then derive three quiet page colours from
// its hue. Pure functions, so they can be unit-tested without a canvas.

/** A cover's dominant colour in OKLCH terms: how colourful it is and which hue. */
export interface CoverColor {
  chroma: number;
  /** Degrees, 0–360. */
  hue: number;
}

/** The page colours derived from a cover, as CSS colour strings. */
export interface PageTint {
  /** Page background. */
  ground: string;
  /** Hairlines. */
  line: string;
  /** Secondary text. */
  muted: string;
}

/** Pixels less colourful than this count as grey, black or white. */
const MIN_PIXEL_CHROMA = 0.04;
/**
 * A hue has to cover at least this share of the cover to tint the page.
 * Small on purpose: a red title on a white sleeve is often only 2–3%.
 */
const MIN_HUE_SHARE = 0.015;
/** 15° buckets; a hue is judged together with its two neighbours (45°). */
const HUE_BUCKETS = 24;
/** Pixels less colourful than this look neutral: white, cream, grey or black. */
const NEUTRAL_CHROMA = 0.06;
/** A cover at least this neutral counts as a plain sleeve with a little colour on it. */
const NEUTRAL_COVER_SHARE = 0.75;

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0–255 per channel) to the a and b axes of OKLab. */
function oklabAB(r: number, g: number, b: number): [number, number] {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * The dominant colour of an image given as RGBA bytes.
 *
 * Colourful pixels vote for their hue weighted by how colourful they are.
 * On a mostly neutral sleeve (white, cream, grey or black) each vote is
 * weighted by the square of how far the pixel is above grey instead, so a
 * little vivid lettering wins over a large area of barely tinted paper.
 * Each hue is scored together with its neighbours, so a colour that
 * straddles a bucket edge isn't split in two. Returns null when the cover
 * has no real colour: mostly grey, black or white, or the winning hue is
 * only a speck.
 */
export function dominantColor(rgba: ArrayLike<number>): CoverColor | null {
  const colourful: { a: number; b: number; chroma: number }[] = [];
  let pixels = 0;
  let neutral = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels++;
    const [a, b] = oklabAB(rgba[i], rgba[i + 1], rgba[i + 2]);
    const chroma = Math.hypot(a, b);
    if (chroma < NEUTRAL_CHROMA) neutral++;
    if (chroma >= MIN_PIXEL_CHROMA) colourful.push({ a, b, chroma });
  }
  const plainCover = pixels > 0 && neutral / pixels >= NEUTRAL_COVER_SHARE;

  const weight = new Array<number>(HUE_BUCKETS).fill(0);
  const count = new Array<number>(HUE_BUCKETS).fill(0);
  const sumA = new Array<number>(HUE_BUCKETS).fill(0);
  const sumB = new Array<number>(HUE_BUCKETS).fill(0);
  for (const { a, b, chroma } of colourful) {
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const bucket = Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    const w = plainCover ? (chroma - MIN_PIXEL_CHROMA) ** 2 : chroma;
    weight[bucket] += w;
    count[bucket]++;
    sumA[bucket] += a * w;
    sumB[bucket] += b * w;
  }

  /** The sum of a per-bucket tally over a bucket and its two neighbours. */
  const around = (tally: number[], bucket: number) =>
    tally[(bucket + HUE_BUCKETS - 1) % HUE_BUCKETS] +
    tally[bucket] +
    tally[(bucket + 1) % HUE_BUCKETS];

  let best = 0;
  for (let bucket = 1; bucket < HUE_BUCKETS; bucket++) {
    if (around(weight, bucket) > around(weight, best)) best = bucket;
  }
  const bestWeight = around(weight, best);
  if (pixels === 0 || bestWeight === 0 || around(count, best) / pixels < MIN_HUE_SHARE) {
    return null;
  }

  // The weighted mean, so the faint fringe of a hue doesn't wash it out.
  const a = around(sumA, best) / bestWeight;
  const b = around(sumB, best) / bestWeight;
  return {
    chroma: Math.hypot(a, b),
    hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}

function oklch(lightness: number, chroma: number, hue: number): string {
  return `oklch(${lightness}% ${chroma.toFixed(4)} ${hue.toFixed(1)})`;
}

/**
 * The page colours for a cover colour. All three share the cover's hue;
 * lightness is fixed and chroma is a capped fraction of the cover's, so the
 * page stays quiet and secondary text keeps about 5.5:1 on the ground
 * whatever the hue.
 */
export function pageTint(color: CoverColor): PageTint {
  return {
    ground: oklch(97, Math.min(0.03, color.chroma * 0.15), color.hue),
    line: oklch(90, Math.min(0.05, color.chroma * 0.25), color.hue),
    muted: oklch(50, Math.min(0.06, color.chroma * 0.3), color.hue),
  };
}
