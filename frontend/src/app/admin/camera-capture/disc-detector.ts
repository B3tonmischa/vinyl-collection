import { Service } from '@angular/core';
import { Circle } from './camera-capture.logic';
import type { DiscReply, DiscRequest } from './disc-detect';

/**
 * Finds records in disc-detect.worker.ts. The worker is created on first use
 * and kept for the session. Resolves to null when it can't run (a browser
 * without module workers, a crash), so the dialog falls back to the guide
 * circle. The ImageData's buffer is transferred to the worker, so the
 * caller's copy is empty afterwards.
 */
@Service()
export class DiscDetector {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (circle: Circle | null) => void>();

  detect(image: ImageData): Promise<Circle | null> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ id, image } satisfies DiscRequest, [image.data.buffer]);
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./disc-detect.worker', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = ({ data }: MessageEvent<DiscReply>) => {
        this.pending.get(data.id)?.(data.circle);
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
