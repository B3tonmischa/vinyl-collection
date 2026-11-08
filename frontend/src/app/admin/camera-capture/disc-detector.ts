import { Service } from '@angular/core';
import type { FoundDisc } from './disc-detect';
import type { Mat3 } from './disc-straighten';

/** What disc-detect.worker.ts is asked; the reply carries the same id. */
export type DiscRequest =
  | { id: number; type: 'find'; image: ImageData }
  | { id: number; type: 'warp'; image: ImageData; toPhoto: Mat3; size: number };

export interface DiscReply {
  id: number;
  result: FoundDisc | ImageData | null;
}

/**
 * Finds and straightens records in disc-detect.worker.ts. The worker is
 * created on first use and kept for the session. Everything resolves to null
 * when it can't run (a browser without module workers, a crash), so the
 * dialog falls back to the guide circle and the photo as it is. ImageData
 * buffers are transferred to the worker, so the caller's copy is empty
 * afterwards.
 */
@Service()
export class DiscDetector {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (result: DiscReply['result']) => void>();

  /** The record in `image`, in its pixels, or null. */
  find(image: ImageData): Promise<FoundDisc | null> {
    return this.request<FoundDisc>({ id: 0, type: 'find', image }, image);
  }

  /** Samples `image` through `toPhoto` (see disc-straighten.ts) into a size×size image. */
  warp(image: ImageData, toPhoto: Mat3, size: number): Promise<ImageData | null> {
    return this.request<ImageData>({ id: 0, type: 'warp', image, toPhoto, size }, image);
  }

  private request<T extends DiscReply['result']>(
    message: DiscRequest,
    image: ImageData,
  ): Promise<T | null> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result as T | null));
      worker.postMessage({ ...message, id }, [image.data.buffer]);
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./disc-detect.worker', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = ({ data }: MessageEvent<DiscReply>) => {
        this.pending.get(data.id)?.(data.result);
        this.pending.delete(data.id);
      };
      worker.onerror = () => this.reset();
      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  /** A crashed worker shouldn't leave callers hanging; the next call starts a fresh one. */
  private reset(): void {
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
