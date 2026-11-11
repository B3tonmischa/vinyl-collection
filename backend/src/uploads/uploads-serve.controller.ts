import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { getUploadsRoot } from './uploads.service';

// Serves processed scans from disk, but — unlike a plain static-file
// middleware — checks the owning VinylImage row first, so a soft-deleted
// image stops being servable the moment it's "deleted", the same as it
// disappears from a vinyl's detail response. Files themselves are left on
// disk (restore needs them back), only what's servable changes.
@Controller('uploads')
export class UploadsServeController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(':vinylId/:filename')
  async serve(
    @Param('vinylId') vinylId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const id = Number(vinylId);
    if (!Number.isInteger(id)) {
      throw new NotFoundException();
    }
    const relativePath = `${vinylId}/${filename}`;
    const image = await this.prisma.vinylImage.findFirst({
      where: {
        // Narrows the lookup to one record's handful of rows (indexed)
        // instead of comparing paths across every image.
        vinylId: id,
        deletedAt: null,
        vinyl: { deletedAt: null },
        OR: [{ fullPath: relativePath }, { thumbPath: relativePath }],
      },
    });
    if (!image) {
      throw new NotFoundException();
    }
    // Every upload gets file names of its own (see UploadsService.saveImage),
    // so what a URL serves never changes and a browser can keep it for good.
    // `private` keeps shared caches (Cloudflare's edge) out of it: they
    // would go on serving an image after it has been deleted here.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(join(getUploadsRoot(), relativePath), { cacheControl: false });
  }
}
