export class CreateProjectDto {
  title: string;
  description: string;
  color: string;
  due_date?: Date;
  user_id: string;
}