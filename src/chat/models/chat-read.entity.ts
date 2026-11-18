import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';

/**
 * A user's chat read point in one project (FEAT-08a): messages created after
 * `last_read_at` (and after a member's join time) are unread. Written only by
 * ChatUnreadService with raw SQL (upsert with GREATEST). Constraint names
 * match migration 1763200000000-ChatReads.
 */
@Entity('chat_reads')
export class ChatReadEntity {
  @PrimaryColumn({ type: 'varchar', primaryKeyConstraintName: 'PK_chat_reads' })
  project_id!: string;

  @PrimaryColumn({ type: 'varchar', primaryKeyConstraintName: 'PK_chat_reads' })
  user_id!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  last_read_at!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'project_id',
    referencedColumnName: 'project_id',
    foreignKeyConstraintName: 'FK_chat_reads_project',
  })
  project?: ProjectEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_chat_reads_user',
  })
  user?: UserEntity;
}
