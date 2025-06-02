// task-instance.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TaskTemplate } from './taskTemplate.entity';
import { Projects } from 'src/projects/models/projects.entity';
import { Users } from 'src/user/models/user.entity';

@Entity()
export class TaskInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({unique:true})
  task_id: string;

  @ManyToOne (() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: Users;

  @ManyToOne(() => Projects, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'project_id' })
  project: Projects;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ['Low', 'Medium', 'High'],
    })
  priority: 'Low' | 'Medium' | 'High';

  @Column({
    type: 'enum',
    enum: ['Pending', 'Complete', 'Overdue'],
    })
  status: 'Pending' | 'Complete' | 'Overdue';

  @Column({ type: 'timestamp', nullable: true })
  due_date: Date;

  @ManyToOne(() => TaskTemplate, (template) => template.instances, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  template: TaskTemplate | null;
}
