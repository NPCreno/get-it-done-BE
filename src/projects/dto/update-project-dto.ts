import { Type } from 'class-transformer';
import { IsDate, IsHexColor, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const { limits } = API_CONTRACT;

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(limits.titleMin)
  @MaxLength(limits.titleMax)
  title?: string;

  // null clears the value
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(limits.descriptionMax)
  description?: string | null;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(limits.colorLabelMax)
  colorLabel?: string;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Date)
  @IsDate()
  due_date?: Date | null;
}
