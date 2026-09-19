import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

// One track in the nested `tracks` array on create/update. `artistIds`
// governs the inherit-vs-override rule (architecture-review-implementation-plan.md #3):
// omitted or empty -> inherits the vinyl's own artists; one or more ids ->
// replaces the inherited list entirely for this track.
export class TrackInputDto {
  @IsInt()
  @Min(1)
  position!: number;

  @IsString()
  @MaxLength(300)
  title!: string;

  // e.g. "A", "B", "C" — letters continue across discs, so this is
  // deliberately not paired with a discNumber.
  @IsOptional()
  @IsString()
  @MaxLength(10)
  side?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  artistIds?: number[];
}
