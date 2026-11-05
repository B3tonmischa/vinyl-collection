import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DiscSize, ReleaseType, Speed } from '../../../generated/prisma/enums';
import { TrackInputDto } from './track-input.dto';

export class CreateVinylDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(1850)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  catalogNumber?: string;

  @IsOptional()
  @IsEnum(ReleaseType)
  releaseType?: ReleaseType;

  @IsOptional()
  @IsEnum(DiscSize)
  discSize?: DiscSize;

  @IsOptional()
  @IsEnum(Speed)
  speed?: Speed;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  genre?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // The album's primary artist(s) — ids of existing Artist rows. Look up or
  // create artists first via the /artists endpoints.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  artistIds?: number[];

  // Full replacement of the tracklist. Omit entirely to leave tracks alone
  // on update; pass [] to clear them.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackInputDto)
  tracks?: TrackInputDto[];
}
