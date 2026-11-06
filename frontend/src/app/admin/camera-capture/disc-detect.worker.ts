/// <reference lib="webworker" />
// Runs detectDisc off the main thread, so the viewfinder stays smooth.
// Wrapped by disc-detector.ts.

import { Circle } from './camera-capture.logic';
import { DiscReply, DiscRequest, detectDisc } from './disc-detect';

addEventListener('message', ({ data }: MessageEvent<DiscRequest>) => {
  let circle: Circle | null = null;
  try {
    circle = detectDisc(data.image);
  } catch (err) {
    console.error('Disc detection failed', err);
  }
  postMessage({ id: data.id, circle } satisfies DiscReply);
});
