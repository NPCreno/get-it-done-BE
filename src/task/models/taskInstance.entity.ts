// task-instance.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { TaskTemplate } from './taskTemplate.entity';
import { Projects } from 'src/projects/models/projects.entity';

@Entity()
export class TaskInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => Projects, { onDelete: 'CASCADE' })
  project: Projects;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  priority: string;

  @Column()
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date;

  @ManyToOne(() => TaskTemplate, (template) => template.instances, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  template: TaskTemplate | null;
}
