import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const { limits } = API_CONTRACT;

/** Owner is the token identity, never a body field. */
export class CreateTaskSubInstanceDto {
  @IsString()
  task_id!: string;

  @IsString()
  @MinLength(limits.titleMin)
  @MaxLength(limits.titleMax)
  title!: string;

  @IsIn([...API_CONTRACT.newTaskStatuses])
  status!: 'Pending' | 'Complete';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  due_date?: Date;
}
