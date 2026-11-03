// Canvas plumbing for camera capture: turning photos/frames into a capped
// "working" canvas, downscaled ImageData for detection, and the final
// upload Files. Geometry lives in camera-capture.logic.ts; perspective
// warping happens in the OpenCV worker (scan-detector.ts).

import {
  Circle,
  DETECT_MAX_EDGE,
  Quad,
  Size,
  WORKING_MAX_EDGE,
  discOutputSize,
  fitSize,
  quadBounds,
  squareOutputSize,
} from './camera-capture.logic';

export function canvasSize(canvas: HTMLCanvasElement): Size {
  return { width: canvas.width, height: canvas.height };
}

function newCanvas(size: Size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return [canvas, ctx];
}

/** Draws any image source onto a canvas no bigger than `maxEdge`. */
export function toWorkingCanvas(
  source: CanvasImageSource,
  sourceSize: Size,
  maxEdge = WORKING_MAX_EDGE,
): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(fitSize(sourceSize, maxEdge));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Decodes a picked file (gallery fallback) with EXIF orientation applied,
 * so phone photos come out upright before any cropping.
 */
export async function fileToWorkingCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return toWorkingCanvas(bitmap, { width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
}

/** Downscaled copy for OpenCV detection, plus the size it was taken at. */
export function detectionImage(
  source: CanvasImageSource,
  sourceSize: Size,
  maxEdge = DETECT_MAX_EDGE,
): ImageData {
  const size = fitSize(sourceSize, maxEdge);
  const [, ctx] = newCanvas(size);
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return ctx.getImageData(0, 0, size.width, size.height);
}

export function fullImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const FILE_TYPES = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg', quality: 0.92 },
  png: { mime: 'image/png', extension: 'png', quality: undefined },
} as const;

/** Encodes a canvas as an upload File named `<name>.<extension>`. */
function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
  format: keyof typeof FILE_TYPES,
): Promise<File> {
  const { mime, extension, quality } = FILE_TYPES[format];
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], `${name}.${extension}`, { type: mime }))
          : reject(new Error('Encoding failed')),
      mime,
      quality,
    ),
  );
}

/** Sleeve output: JPEG (no alpha needed, much smaller than PNG). */
export function imageDataToJpegFile(image: ImageData, name: string): Promise<File> {
  const [canvas, ctx] = newCanvas(image);
  ctx.putImageData(image, 0, 0);
  return canvasToFile(canvas, name, 'jpeg');
}

/**
 * Fallback when OpenCV couldn't load: crop the quad's bounding box and
 * squash it to a square. No perspective correction, but still usable.
 */
export function cropSleeveWithoutWarp(
  working: HTMLCanvasElement,
  quad: Quad,
  name: string,
): Promise<File> {
  const b = quadBounds(quad, canvasSize(working));
  const size = squareOutputSize(quad);
  const [canvas, ctx] = newCanvas({ width: size, height: size });
  ctx.drawImage(working, b.x, b.y, b.width, b.height, 0, 0, size, size);
  return canvasToFile(canvas, name, 'jpeg');
}

/**
 * Disc output: PNG, transparent outside the circle. PNG rather than
 * WebP because iOS Safari's canvas WebP encoding isn't dependable; the
 * backend re-encodes to WebP and sharp keeps the alpha channel.
 */
export function cropDiscToPngFile(
  working: HTMLCanvasElement,
  circle: Circle,
  name: string,
): Promise<File> {
  const size = discOutputSize(circle);
  const [canvas, ctx] = newCanvas({ width: size, height: size });
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    working,
    circle.cx - circle.r,
    circle.cy - circle.r,
    circle.r * 2,
    circle.r * 2,
    0,
    0,
    size,
    size,
  );
  return canvasToFile(canvas, name, 'png');
}
