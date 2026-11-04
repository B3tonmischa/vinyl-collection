import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class DiscogsImportQueryDto {
  // Query values arrive as strings, so "false" would be truthy under a plain
  // Boolean() cast. Anything other than "true"/"false" is passed through
  // untouched and rejected by @IsBoolean() instead of silently meaning false.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  images?: boolean;
}
