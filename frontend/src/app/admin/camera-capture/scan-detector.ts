import { Service } from '@angular/core';
import { Circle, Quad, QuadCandidate } from './camera-capture.logic';

/**
 * What the camera dialog needs from OpenCV. Every method resolves to null
 * when OpenCV isn't available (failed download, old browser) so the
 * dialog degrades to the guide-frame crop instead of breaking.
 * Coordinates are in the pixel space of the ImageData passed in.
 */
export interface ScanDetector {
  /** Starts the (≈10 MB, cached afterwards) OpenCV download early. */
  warmUp(): void;
  /** Possible sleeve outlines, for pickSleeveQuad() to choose from. */
  detectQuads(image: ImageData): Promise<QuadCandidate[] | null>;
  detectCircle(image: ImageData): Promise<Circle | null>;
  /** Perspective-warps an ordered quad to a size×size square. */
  warp(image: ImageData, quad: Quad, size: number): Promise<ImageData | null>;
}

interface Pending {
  resolve: (value: unknown) => void;
}

// Generous: the first load is a 10 MB download over mobile data.
const INIT_TIMEOUT_MS = 90_000;

// Files in public/ aren't content-hashed, so browsers (and phones) keep
// serving a stale worker after a deploy. Bump this whenever
// scan-worker.js changes its protocol or behaviour.
const WORKER_VERSION = 3;

/**
 * Wraps public/vendor/opencv/scan-worker.js. The worker is created lazily
 * on first use and kept for the rest of the session, so a guided scan of
 * a whole record pays the OpenCV start-up cost once.
 */
@Service()
export class OpenCvScanDetector implements ScanDetector {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  warmUp(): void {
    void this.ensureReady();
  }

  async detectQuads(image: ImageData): Promise<QuadCandidate[] | null> {
    return this.request<QuadCandidate[]>({ type: 'detectQuads', image }, [image.data.buffer]);
  }

  async detectCircle(image: ImageData): Promise<Circle | null> {
    return this.request<Circle>({ type: 'detectCircle', image }, [image.data.buffer]);
  }

  async warp(image: ImageData, quad: Quad, size: number): Promise<ImageData | null> {
    return this.request<ImageData>({ type: 'warp', image, quad, size }, [image.data.buffer]);
  }

  private ensureReady(): Promise<boolean> {
    if (!this.ready) {
      this.ready = new Promise<boolean>((resolve) => {
        try {
          // Resolved against <base href>, so it works under /vinyl-collection/ too.
          const url = new URL(`vendor/opencv/scan-worker.js?v=${WORKER_VERSION}`, document.baseURI);
          this.worker = new Worker(url);
        } catch {
          resolve(false);
          return;
        }
        this.worker.onmessage = (
          e: MessageEvent<{ id: number; result?: unknown; error?: string }>,
        ) => {
          const entry = this.pending.get(e.data.id);
          if (!entry) return;
          this.pending.delete(e.data.id);
          entry.resolve(e.data.error === undefined ? (e.data.result ?? null) : null);
        };
        this.worker.onerror = () => this.failAll();
        const timer = setTimeout(() => resolve(false), INIT_TIMEOUT_MS);
        this.post<boolean>({ type: 'init' }, []).then((ok) => {
          clearTimeout(timer);
          resolve(ok === true);
        });
      });
    }
    return this.ready;
  }

  private async request<T>(message: object, transfer: Transferable[]): Promise<T | null> {
    if (!(await this.ensureReady())) return null;
    return this.post<T>(message, transfer);
  }

  private post<T>(message: object, transfer: Transferable[]): Promise<T | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void });
      this.worker!.postMessage({ ...message, id }, transfer);
    });
  }

  /** A crashed worker (e.g. out of memory) shouldn't leave callers hanging. */
  private failAll(): void {
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
