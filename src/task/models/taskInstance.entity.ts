// task-instance.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { TaskTemplateEntity } from './taskTemplate.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskSubInstanceEntity } from './taskSubInstance.entity';

@Entity()
export class TaskInstanceEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  task_id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user!: UserEntity;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'project_id' })
  project!: ProjectEntity;

  @OneToMany('TaskSubInstanceEntity', 'instance', {
    nullable: true,
  })
  subInstances!: TaskSubInstanceEntity[];

  @Column()
  title!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({
    type: 'enum',
    enum: ['Low', 'Medium', 'High'],
  })
  priority!: 'Low' | 'Medium' | 'High';

  @Column({
    type: 'enum',
    enum: ['Pending', 'Complete', 'Overdue'],
  })
  status!: 'Pending' | 'Complete' | 'Overdue';

  @Column({ type: 'timestamp', nullable: true })
  due_date!: Date;

  @ManyToOne(() => TaskTemplateEntity, (template) => template.instances, {
    nullable: true,
    onDelete: 'SET NULL'
  })
  template!: TaskTemplateEntity | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date;
}