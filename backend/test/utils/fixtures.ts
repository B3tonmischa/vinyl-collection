import sharp from 'sharp';

/**
 * Builds a small synthetic JPEG for upload tests. `width`/`height` describe
 * the pixel data as stored; `exifOrientation` (when given) is written into
 * the EXIF Orientation tag, the same way a scanner/phone camera would mark a
 * physically-rotated capture, without actually pre-rotating the pixels.
 */
export async function createTestImageBuffer(options: {
  width: number;
  height: number;
  exifOrientation?: number;
}): Promise<Buffer> {
  const { width, height, exifOrientation } = options;
  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  }).jpeg();

  if (exifOrientation !== undefined) {
    image = image.withMetadata({ orientation: exifOrientation });
  }

  return image.toBuffer();
}
