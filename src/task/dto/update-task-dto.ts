import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const { limits } = API_CONTRACT;

export class UpdateTaskDto {
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
  @IsIn([...API_CONTRACT.taskPriorities])
  priority?: 'Low' | 'Medium' | 'High';

  @IsOptional()
  @IsIn([...API_CONTRACT.taskStatuses])
  status?: 'Pending' | 'Complete' | 'Overdue';

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Date)
  @IsDate()
  due_date?: Date | null;
}
