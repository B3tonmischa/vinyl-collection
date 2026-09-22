import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SwapImagesDto } from './dto/swap-images.dto';
import {
  IMAGE_KIND_SLUGS,
  ImageKindSlug,
  UploadsService,
  parseDiscNumber,
} from './uploads.service';

// No @Public() anywhere here — uploading/deleting scans always requires
// an admin session via the global AuthGuard.
@Controller('vinyls/:vinylId/images')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  // Registered ahead of the `:kind` route below — Nest matches routes in
  // declaration order, and `:kind` would otherwise swallow "swap" as a
  // (invalid) kind value.
  @Post('swap')
  async swap(
    @Param('vinylId', ParseIntPipe) vinylId: number,
    @Body() body: SwapImagesDto,
  ) {
    const [a, b] = await this.uploadsService.swapImages(
      vinylId,
      { kindSlug: body.a.kind, discNumber: body.a.discNumber ?? 1 },
      { kindSlug: body.b.kind, discNumber: body.b.discNumber ?? 1 },
    );
    return { a, b };
  }

  @Post(':kind')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — plenty for a raw scan
    }),
  )
  async upload(
    @Param('vinylId', ParseIntPipe) vinylId: number,
    @Param('kind') kind: string,
    @Query('discNumber') discNumberRaw: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded (expected multipart field "file")',
      );
    }
    this.assertValidKind(kind);
    const discNumber = parseDiscNumber(discNumberRaw);
    return this.uploadsService.saveImage(vinylId, kind, file, discNumber);
  }

  @Delete(':kind')
  async remove(
    @Param('vinylId', ParseIntPipe) vinylId: number,
    @Param('kind') kind: string,
    @Query('discNumber') discNumberRaw: string | undefined,
  ) {
    this.assertValidKind(kind);
    const discNumber = parseDiscNumber(discNumberRaw);
    await this.uploadsService.removeImage(vinylId, kind, discNumber);
    return { status: 'ok' };
  }

  @Post(':kind/restore')
  async restore(
    @Param('vinylId', ParseIntPipe) vinylId: number,
    @Param('kind') kind: string,
    @Query('discNumber') discNumberRaw: string | undefined,
  ) {
    this.assertValidKind(kind);
    const discNumber = parseDiscNumber(discNumberRaw);
    return this.uploadsService.restoreImage(vinylId, kind, discNumber);
  }

  private assertValidKind(kind: string): asserts kind is ImageKindSlug {
    if (!(IMAGE_KIND_SLUGS as readonly string[]).includes(kind)) {
      throw new BadRequestException(
        `Invalid image kind "${kind}". Expected one of: ${IMAGE_KIND_SLUGS.join(', ')}`,
      );
    }
  }
}
