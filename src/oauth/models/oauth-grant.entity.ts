import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from 'src/user/models/user.entity';
import { OAuthClientEntity } from './oauth-client.entity';

/**
 * One user's consent for one client (FEAT-07c): a "connected app". Tokens and
 * codes hang off it; revoking it ends them all. `client_id` references
 * oauth_clients.id (the internal uuid, not the public `gid_cli_` string).
 * `expires_at` is the absolute 180-day limit.
 */
@Entity('oauth_grants')
@Index('IDX_oauth_grants_user', ['user_id'])
@Index('IDX_oauth_grants_client', ['client_id'])
export class OAuthGrantEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_oauth_grants' })
  id!: string;

  @Column({ type: 'varchar' })
  user_id!: string;

  @Column({ type: 'uuid' })
  client_id!: string;

  @Column({ type: 'text', array: true })
  scopes!: string[];

  @Column({ type: 'varchar' })
  resource!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_used_at!: Date | null;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at!: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_oauth_grants_user',
  })
  user?: UserEntity;

  @ManyToOne(() => OAuthClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'client_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_oauth_grants_client',
  })
  client?: OAuthClientEntity;
}
