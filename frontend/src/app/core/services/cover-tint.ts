import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CoverColor, dominantColor } from '../../public/vinyl-detail-page/cover-tint.logic';

const STORAGE_PREFIX = 'vinyl-cover-color:';
/** The cover is sampled at this size; plenty for a dominant colour. */
const SAMPLE_SIZE = 32;

/**
 * Reads a cover photo's dominant colour in the browser.
 *
 * The image is fetched as a blob rather than drawn from an <img>, so the
 * canvas isn't tainted when the API lives on another origin (dev). Results
 * are remembered per image URL — in memory and in localStorage — so a
 * record's page is tinted from its first paint on later visits.
 */
@Service()
export class CoverTintService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, CoverColor | null>();

  /** The remembered colour for an image, or undefined when it hasn't been read yet. */
  cached(url: string): CoverColor | null | undefined {
    if (this.cache.has(url)) return this.cache.get(url);
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + url);
      if (stored === null) return undefined;
      const color = JSON.parse(stored) as CoverColor | null;
      this.cache.set(url, color);
      return color;
    } catch {
      return undefined;
    }
  }

  /** The image's dominant colour; null when it has none or can't be read. */
  async colorOf(url: string): Promise<CoverColor | null> {
    const known = this.cached(url);
    if (known !== undefined) return known;
    try {
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      bitmap.close();
      const color = dominantColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      this.remember(url, color);
      return color;
    } catch {
      // A missing or unreadable cover just means a neutral page.
      return null;
    }
  }

  private remember(url: string, color: CoverColor | null): void {
    this.cache.set(url, color);
    try {
      localStorage.setItem(STORAGE_PREFIX + url, JSON.stringify(color));
    } catch {
      // Private mode or a full quota: the in-memory cache still holds it.
    }
  }
}
