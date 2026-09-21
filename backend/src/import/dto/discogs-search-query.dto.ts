import { IsOptional, IsString, MaxLength } from 'class-validator';

// At least one of these four must be present — that cross-field rule is
// checked in ImportService.search() rather than here, since "at least one
// of several independent optional fields" doesn't map onto a single
// field's class-validator decorators.
export class DiscogsSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  catno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  artist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}
