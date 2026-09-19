import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, rename, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ImageKind } from '../../generated/prisma/client';

// By default sharp/libvips keeps a small LRU cache of recently-touched
// files (and their decoded pixel data) alive across operations, for
// performance, up to `files: 20` open handles at a time. On Linux this is
// invisible because you can unlink/rename over a file that's still open
// elsewhere. On Windows it isn't: a file that's memory-mapped or has an
// open handle from an earlier sharp() read (e.g. a `.metadata()` call right
// after writing it, which every upload test does to verify the result)
// can't be renamed over or deleted until that handle is released — and the
// cache doesn't release it on any short timer, only on LRU eviction. That
// is the actual root cause behind both the "500 on re-upload to the same
// kind" and the "EPERM deleting the uploads temp dir" failures reported
// from Windows: the same destination path gets written, read back with
// sharp for a metadata assertion, and then written again (or the whole
// temp dir gets rm'd) while libvips still has it cached/open. Disabling
// the cache makes sharp fully close each file as soon as that operation's
// promise resolves, so nothing outlives the request that touched it. This
// is a one-line, global, no-downside call (the perf benefit only matters
// for repeatedly re-processing literally the same input, which we never
// do) — see https://sharp.pixelplumbing.com/api-utility#cache.
sharp.cache(false);

// Windows (and sometimes macOS, via antivirus/indexer/search) can also hold
// a brief, unrelated exclusive lock on a just-written file for a few tens
// of milliseconds after it's closed, which surfaces as EPERM/EBUSY/EACCES
// on an immediately-following write, rename, or unlink of that same path.
// This never happens on Linux/POSIX, so it doesn't reproduce in this
// sandbox. Retrying briefly is a safe no-op everywhere else and covers
// that case in addition to the sharp-cache fix above.
const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function withTransientFsRetry<T>(
  fn: () => Promise<T>,
  { retries = 5, delayMs = 100 }: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= retries || !code || !TRANSIENT_FS_ERROR_CODES.has(code)) {
        throw err;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export const IMAGE_KIND_SLUGS = [
  'cover-front',
  'cover-back',
  'inner-sleeve',
  'disc-side-a',
  'disc-side-b',
] as const;
export type ImageKindSlug = (typeof IMAGE_KIND_SLUGS)[number];

const SLUG_TO_KIND: Record<ImageKindSlug, ImageKind> = {
  'cover-front': ImageKind.COVER_FRONT,
  'cover-back': ImageKind.COVER_BACK,
  'inner-sleeve': ImageKind.INNER_SLEEVE,
  'disc-side-a': ImageKind.DISC_SIDE_A,
  'disc-side-b': ImageKind.DISC_SIDE_B,
};

// Packaging-level kinds are one-per-release regardless of how many discs it
// has — discNumber stays 1 for these, unused, no matter what's requested.
// Only the disc-side kinds are genuinely per-disc (see plan doc #4).
const PACKAGING_KINDS = new Set<ImageKind>([
  ImageKind.COVER_FRONT,
  ImageKind.COVER_BACK,
  ImageKind.INNER_SLEEVE,
]);

// Resolved lazily (not at module-load time) so tests can point this at an
// isolated temp directory via UPLOADS_ROOT before the first upload happens.
// Production behavior is unchanged: with no env var set, this is exactly
// `<cwd>/uploads`, same as before.
export function getUploadsRoot(): string {
  return process.env.UPLOADS_ROOT
    ? join(process.env.UPLOADS_ROOT)
    : join(process.cwd(), 'uploads');
}

const FULL_MAX_DIMENSION = 2000;
const THUMB_WIDTH = 500;

function normalizeDiscNumber(kind: ImageKind, requested: number): number {
  return PACKAGING_KINDS.has(kind) ? 1 : requested;
}

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveImage(
    vinylId: number,
    kindSlug: ImageKindSlug,
    file: Express.Multer.File,
    requestedDiscNumber: number,
  ) {
    const vinyl = await this.prisma.vinyl.findFirst({
      where: { id: vinylId, deletedAt: null },
    });
    if (!vinyl) {
      throw new NotFoundException(`Vinyl ${vinylId} not found`);
    }

    const kind = SLUG_TO_KIND[kindSlug];
    const discNumber = normalizeDiscNumber(kind, requestedDiscNumber);
    const dir = join(getUploadsRoot(), String(vinylId));
    await mkdir(dir, { recursive: true });

    const fullFilename = `${kindSlug}-${discNumber}-full.webp`;
    const thumbFilename = `${kindSlug}-${discNumber}-thumb.webp`;
    const fullDest = join(dir, fullFilename);
    const thumbDest = join(dir, thumbFilename);

    // Write to a uniquely-named temp file in the same directory first, then
    // atomically rename into place, instead of having sharp().toFile() write
    // directly to a path that may already exist (the re-upload/overwrite
    // case). That's the scenario where a transient lock on the destination
    // path — held for a moment by e.g. Windows Defender/indexer right after
    // a previous write closed — would otherwise turn into a failed write.
    const tmpFull = join(dir, `.tmp-${randomUUID()}-${fullFilename}`);
    const tmpThumb = join(dir, `.tmp-${randomUUID()}-${thumbFilename}`);

    try {
      // Full size: capped so scans don't bloat storage, but plenty for a lightbox.
      await sharp(file.buffer)
        .rotate() // respect EXIF orientation coming off the scanner
        .resize({
          width: FULL_MAX_DIMENSION,
          height: FULL_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toFile(tmpFull);

      // Thumbnail: for the public grid view.
      await sharp(file.buffer)
        .rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(tmpThumb);

      await withTransientFsRetry(() => rename(tmpFull, fullDest));
      await withTransientFsRetry(() => rename(tmpThumb, thumbDest));
    } catch (err) {
      await Promise.allSettled([unlink(tmpFull), unlink(tmpThumb)]);
      throw new InternalServerErrorException(
        `Failed to process image: ${(err as Error).message}`,
      );
    }

    const fullPath = `${vinylId}/${fullFilename}`;
    const thumbPath = `${vinylId}/${thumbFilename}`;

    // One image per kind per disc per vinyl — re-uploading replaces it, and
    // if this slot was previously soft-deleted, clears that too (a fresh
    // upload always brings the slot back to life).
    return this.prisma.vinylImage.upsert({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
      update: { fullPath, thumbPath, deletedAt: null },
      create: { vinylId, kind, discNumber, fullPath, thumbPath },
    });
  }

  // Soft delete: sets deletedAt on the slot's row. The files stay on disk —
  // restoreImage() only flips deletedAt back, so the bytes need to still be
  // there for that to work.
  async removeImage(
    vinylId: number,
    kindSlug: ImageKindSlug,
    requestedDiscNumber: number,
  ) {
    const kind = SLUG_TO_KIND[kindSlug];
    const discNumber = normalizeDiscNumber(kind, requestedDiscNumber);
    const existing = await this.prisma.vinylImage.findUnique({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(
        `No ${kindSlug} image (disc ${discNumber}) stored for vinyl ${vinylId}`,
      );
    }

    await this.prisma.vinylImage.update({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
      data: { deletedAt: new Date() },
    });
  }

  // Undo — clears deletedAt on a currently soft-deleted slot. Meant to back
  // an immediate "Undo" affordance right after a delete, not a trash view.
  async restoreImage(
    vinylId: number,
    kindSlug: ImageKindSlug,
    requestedDiscNumber: number,
  ) {
    const kind = SLUG_TO_KIND[kindSlug];
    const discNumber = normalizeDiscNumber(kind, requestedDiscNumber);
    const existing = await this.prisma.vinylImage.findUnique({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
    });
    if (!existing || !existing.deletedAt) {
      throw new NotFoundException(
        `No deleted ${kindSlug} image (disc ${discNumber}) for vinyl ${vinylId}`,
      );
    }

    return this.prisma.vinylImage.update({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
      data: { deletedAt: null },
    });
  }
}

export function parseDiscNumber(raw: string | undefined): number {
  if (raw === undefined) {
    return 1;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException('discNumber must be a positive integer');
  }
  return value;
}
