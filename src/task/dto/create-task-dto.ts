export class CreateTaskDto {
  user_id: string;
  project_id?: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date?: Date | null;
  isRecurring: boolean;
  repeat_every?: string;
  repeat_days?: string[];
  start_date?: Date;
  end_date?: Date | null;
}