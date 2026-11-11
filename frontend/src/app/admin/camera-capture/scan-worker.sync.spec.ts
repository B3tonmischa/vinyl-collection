import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKER_VERSION } from './scan-detector';
import {
  Point,
  Quad,
  clamp,
  isPlausibleSleeveQuad,
  orderCorners,
  quadArea,
} from './camera-capture.logic';

/**
 * public/workers/scan-worker.js is a classic worker outside the Angular
 * build (it has to `importScripts` OpenCV), so it can't import from
 * camera-capture.logic.ts and carries its own copies of a few small
 * geometry helpers. These tests load the worker's source and hold those
 * copies to their TypeScript twins, so one can't drift from the other
 * unnoticed.
 */
interface WorkerHelpers {
  clamp(value: number, min: number, max: number): number;
  polygonArea(points: Point[]): number;
  orderClockwise(points: Point[]): Point[];
  plausibleShape(quad: Point[], maxShape: number): boolean;
}

/** The worker's source, with line endings as committed whatever the checkout uses. */
function workerSource(): string {
  return new TextDecoder()
    .decode(readFileSync('public/workers/scan-worker.js'))
    .replace(/\r\n/g, '\n');
}

/** FNV-1a: small and stable, all a "did this file change?" check needs. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function loadWorkerHelpers(): WorkerHelpers {
  const source = workerSource();
  // The worker only touches `self` and `cv` at the top level to register
  // its message handler; nothing here loads OpenCV.
  const run = new Function(
    'self',
    `${source}\nreturn { clamp, polygonArea, orderClockwise, plausibleShape };`,
  );
  return run({}) as WorkerHelpers;
}

/** Small deterministic generator, so a failure names the same quad every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const FRAME = { width: 800, height: 600 };

/** A square-ish sleeve somewhere in the frame: rotated, then each corner nudged. */
function randomQuad(random: () => number): Point[] {
  const side = 180 + random() * 300;
  const angle = random() * Math.PI * 2;
  const cx = 250 + random() * 300;
  const cy = 200 + random() * 200;
  const jitter = side * 0.25;
  return [0, 1, 2, 3].map((i) => {
    const a = angle + (i * Math.PI) / 2 + Math.PI / 4;
    return {
      x: cx + (Math.cos(a) * side) / Math.SQRT2 + (random() - 0.5) * jitter,
      y: cy + (Math.sin(a) * side) / Math.SQRT2 + (random() - 0.5) * jitter,
    };
  });
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('scan-worker.js helpers agree with camera-capture.logic.ts', () => {
  const worker = loadWorkerHelpers();
  const random = seeded(20261112);
  const quads = Array.from({ length: 300 }, () => randomQuad(random));

  it('clamp', () => {
    for (const [value, min, max] of [
      [5, 0, 10],
      [-3, 0, 10],
      [42, 0, 10],
      [0.5, 0.5, 0.5],
    ]) {
      expect(worker.clamp(value, min, max)).toBe(clamp(value, min, max));
    }
  });

  it('polygonArea matches quadArea', () => {
    for (const quad of quads) {
      expect(worker.polygonArea(quad)).toBeCloseTo(quadArea(quad as Quad), 6);
    }
  });

  it('orderClockwise goes round the same way as orderCorners', () => {
    for (const quad of quads) {
      const corners = shuffled(quad, random);
      const expected = orderCorners(corners);
      const fromWorker = worker.orderClockwise(corners);
      // orderCorners also rotates the top-left corner to the front; the
      // worker's copy doesn't promise a starting corner.
      const start = fromWorker.indexOf(expected[0]);
      expect(start).toBeGreaterThanOrEqual(0);
      expect([0, 1, 2, 3].map((i) => fromWorker[(start + i) % 4])).toEqual(expected);
    }
  });

  it('plausibleShape never throws out a quad the main thread would accept', () => {
    // The worker's test is a cheap pre-filter in front of
    // isPlausibleSleeveQuad; it has to stay the looser of the two, or
    // good outlines are dropped before they are ever scored.
    let accepted = 0;
    for (const shapes of [[1], [1, 2]]) {
      const maxShape = Math.max(...shapes);
      for (const quad of quads) {
        const ordered = orderCorners(quad);
        if (!isPlausibleSleeveQuad(ordered, FRAME, shapes)) continue;
        accepted++;
        expect(worker.plausibleShape(ordered, maxShape)).toBe(true);
      }
    }
    // The sample has to actually exercise the comparison.
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('scan-worker.js is served under a URL that changes with it', () => {
  // The worker is cached by browsers for a year (frontend/Caddyfile), under
  // a URL that only differs by ?v=WORKER_VERSION. Changed the worker? Bump
  // WORKER_VERSION in scan-detector.ts, then put the new pair here.
  const RELEASED = { version: 6, checksum: '8d6c73ea' };

  it('has a new WORKER_VERSION whenever its source changes', () => {
    expect({ version: WORKER_VERSION, checksum: checksum(workerSource()) }).toEqual(RELEASED);
  });
});
