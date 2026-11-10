import { describe, expect, it } from 'vitest';
import { dominantColor, pageTint } from './cover-tint.logic';

type Rgb = [number, number, number];

/** RGBA bytes for a list of [colour, pixel count] runs. */
function pixels(...runs: [Rgb, number][]): number[] {
  const out: number[] = [];
  for (const [[r, g, b], n] of runs) {
    for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  }
  return out;
}

const YELLOW: Rgb = [250, 210, 40];
const BLUE: Rgb = [20, 60, 160];
const PAPER: Rgb = [228, 228, 226];
const BLACK: Rgb = [12, 12, 12];

describe('dominantColor', () => {
  it('finds the hue of a single-colour cover', () => {
    const color = dominantColor(pixels([YELLOW, 100]));
    expect(color).not.toBeNull();
    expect(color!.hue).toBeGreaterThan(80);
    expect(color!.hue).toBeLessThan(110);
    expect(color!.chroma).toBeGreaterThan(0.1);
  });

  it('lets strong strokes on a pale sleeve win over the paper', () => {
    const color = dominantColor(pixels([PAPER, 80], [YELLOW, 20]));
    expect(color!.hue).toBeGreaterThan(80);
    expect(color!.hue).toBeLessThan(110);
  });

  it('picks the hue with the most colour behind it', () => {
    const color = dominantColor(pixels([BLUE, 70], [YELLOW, 10], [PAPER, 20]));
    expect(color!.hue).toBeGreaterThan(240);
    expect(color!.hue).toBeLessThan(280);
  });

  it('finds no colour in a grey, black and white cover', () => {
    expect(dominantColor(pixels([PAPER, 50], [BLACK, 50]))).toBeNull();
  });

  it('ignores a speck of colour', () => {
    expect(dominantColor(pixels([PAPER, 98], [YELLOW, 2]))).toBeNull();
  });

  it('ignores transparent pixels', () => {
    const transparentYellow = [...YELLOW, 0];
    expect(dominantColor([...transparentYellow, ...pixels([PAPER, 10])])).toBeNull();
  });

  it('finds no colour in an empty image', () => {
    expect(dominantColor([])).toBeNull();
  });
});

describe('pageTint', () => {
  it('keeps the hue and scales the chroma down for each role', () => {
    expect(pageTint({ chroma: 0.1, hue: 95 })).toEqual({
      ground: 'oklch(97% 0.0150 95.0)',
      line: 'oklch(90% 0.0250 95.0)',
      muted: 'oklch(50% 0.0300 95.0)',
    });
  });

  it('caps the chroma for a very colourful cover', () => {
    expect(pageTint({ chroma: 0.3, hue: 255 })).toEqual({
      ground: 'oklch(97% 0.0300 255.0)',
      line: 'oklch(90% 0.0500 255.0)',
      muted: 'oklch(50% 0.0600 255.0)',
    });
  });
});
