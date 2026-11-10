import { Type } from 'class-transformer';
import {
  ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';
import { IsAfterOrEqual } from 'src/common/is-after-or-equal';

const { limits } = API_CONTRACT;
const isRecurring = (o: CreateTaskDto) => o.isRecurring === true;
const isWeekly = (o: CreateTaskDto) => o.isRecurring === true && o.repeat_every === 'Week';

/** Owner is the token identity, never a body field. */
export class CreateTaskDto {
  @IsOptional()
  @IsString()
  project_id?: string;

  @IsString()
  @MinLength(limits.titleMin)
  @MaxLength(limits.titleMax)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(limits.descriptionMax)
  description?: string;

  @IsIn([...API_CONTRACT.taskPriorities])
  priority!: 'Low' | 'Medium' | 'High';

  @IsIn([...API_CONTRACT.newTaskStatuses])
  status!: 'Pending' | 'Complete';

  @IsBoolean()
  isRecurring!: boolean;

  @ValidateIf(isRecurring)
  @IsIn([...API_CONTRACT.repeatEvery])
  repeat_every?: 'Day' | 'Week' | 'Month';

  @ValidateIf(isWeekly)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...API_CONTRACT.weekdays], { each: true })
  repeat_days?: string[];

  @ValidateIf(isRecurring)
  @Type(() => Date)
  @IsDate()
  start_date?: Date;

  @ValidateIf((o: CreateTaskDto) => isRecurring(o) && o.end_date !== undefined && o.end_date !== null)
  @Type(() => Date)
  @IsDate()
  @IsAfterOrEqual('start_date')
  end_date?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  due_date?: Date;
}
