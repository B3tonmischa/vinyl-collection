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
/** A hue has to cover at least this share of the cover to tint the page. */
const MIN_HUE_SHARE = 0.05;
const HUE_BUCKETS = 12;

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
 * Colourful pixels vote for their hue (in 30° buckets) weighted by how
 * colourful they are, so a few strong strokes on a pale sleeve still win
 * over the paper. Returns null when the cover has no real colour: mostly
 * grey, black or white, or the winning hue is only a speck.
 */
export function dominantColor(rgba: ArrayLike<number>): CoverColor | null {
  const weight = new Array<number>(HUE_BUCKETS).fill(0);
  const count = new Array<number>(HUE_BUCKETS).fill(0);
  const sumA = new Array<number>(HUE_BUCKETS).fill(0);
  const sumB = new Array<number>(HUE_BUCKETS).fill(0);
  let pixels = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels++;
    const [a, b] = oklabAB(rgba[i], rgba[i + 1], rgba[i + 2]);
    const chroma = Math.hypot(a, b);
    if (chroma < MIN_PIXEL_CHROMA) continue;
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const bucket = Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    weight[bucket] += chroma;
    count[bucket]++;
    sumA[bucket] += a;
    sumB[bucket] += b;
  }

  let best = 0;
  for (let bucket = 1; bucket < HUE_BUCKETS; bucket++) {
    if (weight[bucket] > weight[best]) best = bucket;
  }
  if (pixels === 0 || count[best] / pixels < MIN_HUE_SHARE) return null;

  const a = sumA[best] / count[best];
  const b = sumB[best] / count[best];
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
