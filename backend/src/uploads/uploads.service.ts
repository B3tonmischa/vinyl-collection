import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join, resolve, sep } from 'path';
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
// on an immediately-following unlink of that same path.
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
  'inner-sleeve-a',
  'inner-sleeve-b',
  'disc-side-a',
  'disc-side-b',
] as const;
export type ImageKindSlug = (typeof IMAGE_KIND_SLUGS)[number];

const SLUG_TO_KIND: Record<ImageKindSlug, ImageKind> = {
  'cover-front': ImageKind.COVER_FRONT,
  'cover-back': ImageKind.COVER_BACK,
  'inner-sleeve-a': ImageKind.INNER_SLEEVE_A,
  'inner-sleeve-b': ImageKind.INNER_SLEEVE_B,
  'disc-side-a': ImageKind.DISC_SIDE_A,
  'disc-side-b': ImageKind.DISC_SIDE_B,
};

// Packaging-level kinds are one-per-release regardless of how many discs it
// has — discNumber stays 1 for these, unused, no matter what's requested.
// Only the disc-side kinds are genuinely per-disc (see plan doc #4).
const PACKAGING_KINDS = new Set<ImageKind>([
  ImageKind.COVER_FRONT,
  ImageKind.COVER_BACK,
  ImageKind.INNER_SLEEVE_A,
  ImageKind.INNER_SLEEVE_B,
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

/** How long a deleted image (or a deleted record's images) stays on disk. */
export const DELETED_IMAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadsService.name);
  private purgeTimer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const purge = () =>
      this.purgeExpired().catch((err) =>
        this.logger.warn(`Purging deleted images failed: ${(err as Error).message}`),
      );
    void purge();
    this.purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);
    // Never the reason the process stays alive.
    this.purgeTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

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

    // Anything sharp can't read is the client's mistake (400), not a
    // server error — checked before a directory or file is created.
    try {
      await sharp(file.buffer).metadata();
    } catch {
      throw new BadRequestException('The uploaded file is not a supported image');
    }

    const kind = SLUG_TO_KIND[kindSlug];
    const discNumber = normalizeDiscNumber(kind, requestedDiscNumber);
    await mkdir(join(getUploadsRoot(), String(vinylId)), { recursive: true });

    // Every upload gets file names of its own; nothing on disk is ever
    // written twice. That matters three ways:
    //  - swapImages() moves file references between rows, so a name
    //    derived from the slot alone could belong to the *other* slot by
    //    now, and re-uploading would overwrite that slot's picture.
    //  - what a URL serves never changes, so it can be cached for good
    //    (see uploads-serve.controller.ts).
    //  - there is no existing file to rename over, which was the fragile
    //    step on Windows.
    const token = randomBytes(6).toString('hex');
    const fullPath = `${vinylId}/${kindSlug}-${discNumber}-${token}-full.webp`;
    const thumbPath = `${vinylId}/${kindSlug}-${discNumber}-${token}-thumb.webp`;

    try {
      // One decode feeds both sizes. rotate() respects the EXIF
      // orientation coming off the scanner.
      const source = sharp(file.buffer).rotate();
      await Promise.all([
        // Full size: capped so scans don't bloat storage, but plenty for a lightbox.
        source
          .clone()
          .resize({
            width: FULL_MAX_DIMENSION,
            height: FULL_MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toFile(join(getUploadsRoot(), fullPath)),
        // Thumbnail: for the public grid view.
        source
          .clone()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(join(getUploadsRoot(), thumbPath)),
      ]);
    } catch (err) {
      await this.removeFiles([fullPath, thumbPath]);
      // The detail (paths, libvips internals) goes to the log, not the client.
      this.logger.error(`Failed to process image for vinyl ${vinylId}`, (err as Error).stack);
      throw new InternalServerErrorException('Failed to process image');
    }

    // One image per kind per disc per vinyl — re-uploading replaces it, and
    // if this slot was previously soft-deleted, clears that too (a fresh
    // upload always brings the slot back to life).
    const slot = { vinylId_kind_discNumber: { vinylId, kind, discNumber } };
    try {
      const previous = await this.prisma.vinylImage.findUnique({ where: slot });
      const saved = await this.prisma.vinylImage.upsert({
        where: slot,
        update: { fullPath, thumbPath, deletedAt: null },
        create: { vinylId, kind, discNumber, fullPath, thumbPath },
      });
      // The files this slot pointed at until now belong to nothing anymore.
      if (previous) {
        await this.removeFiles([previous.fullPath, previous.thumbPath]);
      }
      return saved;
    } catch (err) {
      await this.removeFiles([fullPath, thumbPath]);
      throw err;
    }
  }

  /**
   * Removes, for good, images whose slot — or whose whole record — was
   * deleted longer ago than the retention period: the files and the image
   * rows. Deleting only ever hides things (so Undo can bring them back),
   * which otherwise leaves every deleted scan on disk forever. A deleted
   * record's own row is kept; only its pictures go.
   *
   * Runs at startup and once a day. Returns how many images were purged.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DELETED_IMAGE_RETENTION_MS);
    const expired = await this.prisma.vinylImage.findMany({
      where: {
        OR: [{ deletedAt: { lt: cutoff } }, { vinyl: { deletedAt: { lt: cutoff } } }],
      },
    });
    for (const image of expired) {
      await this.prisma.vinylImage.delete({ where: { id: image.id } });
      await this.removeFiles([image.fullPath, image.thumbPath]);
    }
    if (expired.length > 0) {
      this.logger.log(`Purged ${expired.length} image(s) deleted more than 30 days ago`);
    }
    return expired.length;
  }

  // Best effort: a file that's already gone is fine, and one that can't be
  // removed is only wasted space — never a reason to fail the request.
  private async removeFiles(relativePaths: string[]): Promise<void> {
    const root = resolve(getUploadsRoot());
    for (const relativePath of relativePaths) {
      const target = resolve(root, relativePath);
      // Paths come from the database, but never follow one out of the root.
      if (!target.startsWith(root + sep)) continue;
      try {
        await withTransientFsRetry(() => unlink(target));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Could not remove ${relativePath}: ${(err as Error).message}`);
        }
      }
    }
  }

  // Soft delete: sets deletedAt on the slot's row. The files stay on disk —
  // restoreImage() only flips deletedAt back, so the bytes need to still be
  // there for that to work.
  async removeImage(
    vinylId: number,
    kindSlug: ImageKindSlug,
    requestedDiscNumber: number,
  ) {
    const { discNumber, image } = await this.findSlot(vinylId, kindSlug, requestedDiscNumber);
    if (!image || image.deletedAt) {
      throw new NotFoundException(
        `No ${kindSlug} image (disc ${discNumber}) stored for vinyl ${vinylId}`,
      );
    }

    await this.prisma.vinylImage.update({
      where: { id: image.id },
      data: { deletedAt: new Date() },
    });
  }

  // Swaps the images between two filled slots. Only the file references
  // (fullPath/thumbPath) move between the two rows — the rows themselves
  // stay pinned to their own kind/discNumber, so this can never collide
  // with the @@unique([vinylId, kind, discNumber]) constraint and never
  // touches a file on disk, which is also what makes it safe against data
  // loss: it's two DB writes in one transaction, nothing to partially fail.
  async swapImages(
    vinylId: number,
    a: { kindSlug: ImageKindSlug; discNumber: number },
    b: { kindSlug: ImageKindSlug; discNumber: number },
  ) {
    const kindA = SLUG_TO_KIND[a.kindSlug];
    const kindB = SLUG_TO_KIND[b.kindSlug];
    if (
      kindA === kindB &&
      normalizeDiscNumber(kindA, a.discNumber) === normalizeDiscNumber(kindB, b.discNumber)
    ) {
      throw new BadRequestException('Cannot swap a slot with itself');
    }

    const [slotA, slotB] = await Promise.all([
      this.findSlot(vinylId, a.kindSlug, a.discNumber),
      this.findSlot(vinylId, b.kindSlug, b.discNumber),
    ]);
    const imageA = slotA.image;
    const imageB = slotB.image;

    if (!imageA || imageA.deletedAt) {
      throw new NotFoundException(
        `No ${a.kindSlug} image (disc ${slotA.discNumber}) stored for vinyl ${vinylId}`,
      );
    }
    if (!imageB || imageB.deletedAt) {
      throw new NotFoundException(
        `No ${b.kindSlug} image (disc ${slotB.discNumber}) stored for vinyl ${vinylId}`,
      );
    }

    const [updatedA, updatedB] = await this.prisma.$transaction([
      this.prisma.vinylImage.update({
        where: { id: imageA.id },
        data: { fullPath: imageB.fullPath, thumbPath: imageB.thumbPath },
      }),
      this.prisma.vinylImage.update({
        where: { id: imageB.id },
        data: { fullPath: imageA.fullPath, thumbPath: imageA.thumbPath },
      }),
    ]);

    return [updatedA, updatedB] as const;
  }

  // Undo — clears deletedAt on a currently soft-deleted slot. Meant to back
  // an immediate "Undo" affordance right after a delete, not a trash view.
  async restoreImage(
    vinylId: number,
    kindSlug: ImageKindSlug,
    requestedDiscNumber: number,
  ) {
    const { discNumber, image } = await this.findSlot(vinylId, kindSlug, requestedDiscNumber);
    if (!image || !image.deletedAt) {
      throw new NotFoundException(
        `No deleted ${kindSlug} image (disc ${discNumber}) for vinyl ${vinylId}`,
      );
    }

    return this.prisma.vinylImage.update({
      where: { id: image.id },
      data: { deletedAt: null },
    });
  }

  // Looks up a slot's row (soft-deleted or not — callers decide what counts
  // as "missing"), normalizing discNumber the same way saveImage() does.
  private async findSlot(vinylId: number, kindSlug: ImageKindSlug, requestedDiscNumber: number) {
    const kind = SLUG_TO_KIND[kindSlug];
    const discNumber = normalizeDiscNumber(kind, requestedDiscNumber);
    const image = await this.prisma.vinylImage.findUnique({
      where: { vinylId_kind_discNumber: { vinylId, kind, discNumber } },
    });
    return { discNumber, image };
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
