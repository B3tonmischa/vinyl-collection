import { Service } from '@angular/core';
import { Quad, QuadCandidate, Size } from './camera-capture.logic';

/** Requests understood by public/workers/scan-worker.js (the reply carries the same id). */
type ScanRequest =
  | { type: 'init' }
  | { type: 'detectQuads'; image: ImageData; maxShape: number }
  | { type: 'warp'; image: ImageData; quad: Quad; width: number; height: number };

type ScanReply = { id: number; result?: unknown; error?: string };

// Generous: the first load is a 10 MB download over mobile data.
const INIT_TIMEOUT_MS = 90_000;

// Files in public/ aren't content-hashed, and the worker is served with a
// cache lifetime of a year (see frontend/Caddyfile), so the URL has to
// change whenever the file does. Bump this on every change to
// scan-worker.js; scan-worker.sync.spec.ts fails until you do.
export const WORKER_VERSION = 6;

/**
 * What the camera dialog needs from OpenCV, run in
 * public/workers/scan-worker.js. The worker is created lazily on first use
 * and kept for the rest of the session, so a guided scan of a whole
 * record pays the OpenCV start-up cost once.
 *
 * Every method resolves to null when OpenCV isn't available (failed
 * download, old browser) so the dialog degrades to the guide-frame crop
 * instead of breaking. Coordinates are in the pixel space of the
 * ImageData passed in. The ImageData's buffer is transferred to the
 * worker, so the caller's copy is empty afterwards.
 */
@Service()
export class OpenCvScanDetector {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (result: unknown) => void>();

  /** Starts the (≈10 MB, cached afterwards) OpenCV download early. */
  warmUp(): void {
    void this.ensureReady();
  }

  /**
   * Possible sleeve outlines, for pickSleeveQuad() to choose from.
   * `maxShape` is the longest shape worth proposing, long side over short.
   */
  detectQuads(image: ImageData, maxShape = 1): Promise<QuadCandidate[] | null> {
    return this.request({ type: 'detectQuads', image, maxShape }, [image.data.buffer]);
  }

  /** Perspective-warps an ordered quad to a rectangle of `size`. */
  warp(image: ImageData, quad: Quad, size: Size): Promise<ImageData | null> {
    const { width, height } = size;
    return this.request({ type: 'warp', image, quad, width, height }, [image.data.buffer]);
  }

  private ensureReady(): Promise<boolean> {
    this.ready ??= this.start();
    return this.ready;
  }

  private start(): Promise<boolean> {
    let worker: Worker;
    try {
      // Resolved against <base href>, so it works under /vinyl-collection/ too.
      const url = new URL(`workers/scan-worker.js?v=${WORKER_VERSION}`, document.baseURI);
      worker = new Worker(url);
    } catch {
      return Promise.resolve(false);
    }
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<ScanReply>) => {
      const resolve = this.pending.get(data.id);
      if (!resolve) return;
      this.pending.delete(data.id);
      resolve(data.error === undefined ? (data.result ?? null) : null);
    };
    worker.onerror = () => this.reset();
    return new Promise<boolean>((resolve) => {
      // Give up on this worker, so a later call starts a fresh one.
      const timer = setTimeout(() => {
        this.reset();
        resolve(false);
      }, INIT_TIMEOUT_MS);
      void this.post<boolean>(worker, { type: 'init' }, []).then((ok) => {
        clearTimeout(timer);
        resolve(ok === true);
      });
    });
  }

  private async request<T>(message: ScanRequest, transfer: Transferable[]): Promise<T | null> {
    if (!(await this.ensureReady()) || !this.worker) return null;
    return this.post<T>(this.worker, message, transfer);
  }

  private post<T>(
    worker: Worker,
    message: ScanRequest,
    transfer: Transferable[],
  ): Promise<T | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result as T | null));
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** A crashed or stuck worker (e.g. out of memory) shouldn't leave callers hanging. */
  private reset(): void {
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
