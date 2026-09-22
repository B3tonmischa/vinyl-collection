import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { IMAGE_KIND_SLUGS, ImageKindSlug } from '../uploads.service';

class ImageSlotRefDto {
  @IsIn(IMAGE_KIND_SLUGS)
  kind!: ImageKindSlug;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  discNumber?: number;
}

// Body for POST /vinyls/:vinylId/images/swap — the two filled slots to swap.
export class SwapImagesDto {
  @ValidateNested()
  @Type(() => ImageSlotRefDto)
  a!: ImageSlotRefDto;

  @ValidateNested()
  @Type(() => ImageSlotRefDto)
  b!: ImageSlotRefDto;
}
