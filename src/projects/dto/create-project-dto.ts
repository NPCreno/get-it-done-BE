import { Type } from 'class-transformer';
import { IsDate, IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const { limits } = API_CONTRACT;

/** Owner is the token identity, never a body field. */
export class CreateProjectDto {
  @IsString()
  @MinLength(limits.titleMin)
  @MaxLength(limits.titleMax)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(limits.descriptionMax)
  description?: string;

  @IsHexColor()
  color!: string;

  @IsString()
  @MaxLength(limits.colorLabelMax)
  colorLabel!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  due_date?: Date;
}
