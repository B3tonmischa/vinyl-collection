/// <reference lib="webworker" />
// Finds and straightens records off the main thread, so the viewfinder stays
// smooth. Wrapped by disc-detector.ts.

import { findDisc } from './disc-detect';
import type { DiscReply, DiscRequest } from './disc-detector';
import { warpImage } from './disc-straighten';

addEventListener('message', ({ data }: MessageEvent<DiscRequest>) => {
  let result: DiscReply['result'] = null;
  const transfer: Transferable[] = [];
  try {
    if (data.type === 'find') {
      result = findDisc(data.image);
    } else {
      const pixels = warpImage(data.image, data.toPhoto, data.size);
      result = new ImageData(pixels, data.size, data.size);
      transfer.push(pixels.buffer);
    }
  } catch (err) {
    console.error(`Disc ${data.type} failed`, err);
  }
  postMessage({ id: data.id, result } satisfies DiscReply, transfer);
});
