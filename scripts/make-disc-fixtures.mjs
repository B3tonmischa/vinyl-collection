#!/usr/bin/env node
// Turns the example photos into the raw frames disc-detect.spec.ts runs on, at
// the sizes the app detects on. The output is gitignored: the photos show a
// real room and this repo is public, so the spec skips them when they're absent.
//
//   node scripts/make-disc-fixtures.mjs [folder with the photos]

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(join(root, 'backend', 'package.json'))('sharp');

const folder = process.argv[2] ?? join(root, '..', 'vinyl_images');
const output = join(root, 'frontend/src/app/admin/camera-capture/testing/disc-photos');
const photos = [
  'IMG_20261104_233602',
  'IMG_20261104_233608',
  'IMG_20261104_233611',
  'IMG_20261104_233617',
  'IMG_20261104_235901',
];
// DETECT_MAX_EDGE and LIVE_DETECT_MAX_EDGE in camera-capture.logic.ts.
const edges = [800, 560];

mkdirSync(output, { recursive: true });
for (const photo of photos) {
  for (const edge of edges) {
    const { data, info } = await sharp(join(folder, `${photo}.jpg`))
      .rotate()
      .resize(edge, edge, { fit: 'inside', kernel: 'linear' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const file = `${photo}-${info.width}x${info.height}.rgba.gz`;
    writeFileSync(join(output, file), gzipSync(data));
    console.log(file);
  }
}
