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
    const relativePath = `${vinylId}/${filename}`;
    const image = await this.prisma.vinylImage.findFirst({
      where: {
        deletedAt: null,
        OR: [{ fullPath: relativePath }, { thumbPath: relativePath }],
      },
    });
    if (!image) {
      throw new NotFoundException();
    }
    res.sendFile(join(getUploadsRoot(), relativePath));
  }
}
