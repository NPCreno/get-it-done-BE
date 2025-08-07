export class CreateTaskSubInstanceDto {
    user_id!: string;
    title!: string;
    status!: 'Pending' | 'Complete' | 'Overdue';
    due_date!: Date;
    task_id!: string;
}