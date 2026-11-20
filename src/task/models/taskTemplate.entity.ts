import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskInstanceEntity } from './taskInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';

@Entity()
export class TaskTemplateEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user_id!: string;

  @Column({ nullable: true })
  project_id!: string;

  /** REF-14c: migration TemplateAndTokenForeignKeys. The code reads user_id. */
  @ManyToOne(() => UserEntity, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: true,
  })
  @JoinColumn({
    name: 'user_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_task_template_user',
  })
  user?: UserEntity;

  /** REF-14c: hard-deleting a project removes its templates. */
  @ManyToOne(() => ProjectEntity, {
    onDelete: 'CASCADE',
    nullable: true,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({
    name: 'project_id',
    referencedColumnName: 'project_id',
    foreignKeyConstraintName: 'FK_task_template_project',
  })
  project?: ProjectEntity | null;

  @Column({ unique: true })
  taskTemplate_id!: string;

  @Column()
  title!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({
    type: 'enum',
    enum: ['Day', 'Week', 'Month'],
  })
  repeat_every!: 'Day' | 'Week' | 'Month';

  @Column({ type: 'simple-array', nullable: true })
  repeat_days!: string[]; // e.g., ["Monday", "Thursday"]

  @Column({ type: 'timestamp' })
  start_date!: Date;

  @Column({ type: 'timestamp', nullable: true })
  end_date!: Date;

  //dates
  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date;

  @OneToMany(() => TaskInstanceEntity, (instance) => instance.template)
  instances!: TaskInstanceEntity[];
}
