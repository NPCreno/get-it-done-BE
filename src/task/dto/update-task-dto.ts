export class UpdateTaskDto {
  title: string;
  description: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Pending' | 'Complete' | 'Overdue';
  due_date?: Date;
}
