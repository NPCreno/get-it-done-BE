import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';

/**
 * A user a project's owner shared the project with (chat only, no tasks).
 * The owner is never a row here: ownership stays `project_entity.user_id`.
 * Constraint names match migration 1763100000000-ProjectChat.
 */
@Entity('project_members')
@Index('IDX_project_members_user', ['user_id'])
export class ProjectMemberEntity {
  @PrimaryColumn({
    type: 'varchar',
    primaryKeyConstraintName: 'PK_project_members',
  })
  project_id!: string;

  @PrimaryColumn({
    type: 'varchar',
    primaryKeyConstraintName: 'PK_project_members',
  })
  user_id!: string;

  @Column({ type: 'varchar' })
  added_by!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'project_id',
    referencedColumnName: 'project_id',
    foreignKeyConstraintName: 'FK_project_members_project',
  })
  project?: ProjectEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_project_members_user',
  })
  user?: UserEntity;
}
