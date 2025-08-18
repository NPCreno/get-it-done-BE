import { IsString, IsIn, IsBoolean, IsArray, IsDate } from 'class-validator';
export class CreateTaskDto {
  @IsString()
  user_id!: string;
  
  @IsString()
  project_id!: string;
  
  @IsString()
  title!: string;
  
  @IsString()
  description!: string;
  
  @IsIn(['Low', 'Medium', 'High'])
  priority!: 'Low' | 'Medium' | 'High';
  
  @IsIn(['Pending', 'Complete'])
  status!: 'Pending' | 'Complete';
  
  @IsBoolean()
  isRecurring!: boolean;
  
  @IsIn(['Day', 'Week', 'Month'])
  repeat_every?: 'Day' | 'Week' | 'Month';
  
  @IsArray()
  repeat_days?: string[];
  
  @IsDate()
  start_date?: Date;
  
  @IsDate()
  end_date?: Date;
  
  @IsDate()
  due_date?: Date;
}

export type CreateBulkTasksDto = CreateTaskDto[];