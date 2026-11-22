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
  Index,
} from 'typeorm';
import { TaskTemplateEntity } from './taskTemplate.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskSubInstanceEntity } from './taskSubInstance.entity';

/**
 * FEAT-09a indexes, created by migration SharedTasks only (TypeORM cannot
 * declare an expression index; the partial one would show as drift):
 * `idx_task_responsible` on `(COALESCE(assignee_id, user_id))` and
 * `idx_task_assignee` on `(assignee_id) WHERE assignee_id IS NOT NULL`.
 */
@Entity()
@Index('idx_task_responsible', { synchronize: false })
@Index('idx_task_assignee', { synchronize: false })
export class TaskInstanceEntity {
  /**
   * uuid, as production has always had it (OPS-04). Nothing joins on it:
   * sub-tasks and every route use `task_id`.
   */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  task_id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user!: UserEntity;

  /**
   * FEAT-09a: who the task is assigned to (the project owner or a member), or
   * null. `user` stays the creator. Responsible = COALESCE(assignee, creator).
   */
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assignee_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_task_assignee',
  })
  assignee!: UserEntity | null;

  @Column({ type: 'varchar', nullable: true })
  assignee_id!: string | null;

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
    onDelete: 'SET NULL',
  })
  template!: TaskTemplateEntity | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date;
}
