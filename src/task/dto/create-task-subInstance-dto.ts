import { IsString, IsIn, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
export class CreateTaskSubInstanceDto {
    @IsString()
    user_id!: string;
    
    @IsString()
    task_id!: string;
    
    @IsString()
    title!: string;
    
    @IsIn(['Pending', 'Complete'])
    status!: 'Pending' | 'Complete';
    
    @IsOptional()
    due_date?: Date;
}

export type CreateBulkSubTasksDto = CreateTaskSubInstanceDto[];