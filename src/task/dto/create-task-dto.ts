export class CreateTaskDto {
  user_id: string;
  project_id?: string;
  title: string;
  description: string;
   priority: 'Low' | 'Medium' | 'High';
  status: 'Pending' | 'Complete';
  due_date?: Date;
  isRecurring: boolean;
  repeat_every?: 'Day' | 'Week' | 'Month';
  repeat_days?: string[];
  start_date?: Date;
  end_date?: Date;
}