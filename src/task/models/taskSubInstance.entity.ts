import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TaskInstanceEntity } from './taskInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';

@Entity()
export class TaskSubInstanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  taskSubInstance_id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user!: UserEntity;

  @Column()
  title!: string;

  @Column({
    type: 'enum',
    enum: ['Pending', 'Complete', 'Overdue'],
  })
  status!: 'Pending' | 'Complete' | 'Overdue';

  @Column({ type: 'timestamp', nullable: true })
  due_date!: Date;

  @ManyToOne(() => TaskInstanceEntity, 'subInstances', {
    nullable: true,
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'task_id' })
  instance!: TaskInstanceEntity;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date;
}
