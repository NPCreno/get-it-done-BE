import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { OAuthGrantEntity } from './oauth-grant.entity';

/**
 * An OAuth access or refresh token (FEAT-07c). Only the sha256 of the secret
 * is stored; `prefix` is the public lookup key. Tokens are issued in pairs:
 * an access row's `pair_id` is the refresh row issued with it. A rotated
 * refresh row has `rotated_at` and `replaced_by` (its successor); `used_at` on
 * a refresh row is the first use of it or of its paired access token.
 */
@Entity('oauth_tokens')
@Unique('UQ_oauth_tokens_prefix', ['prefix'])
@Index('IDX_oauth_tokens_grant', ['grant_id'])
export class OAuthTokenEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_oauth_tokens' })
  id!: string;

  @Column({ type: 'uuid' })
  grant_id!: string;

  /** 'access' or 'refresh'. */
  @Column({ type: 'varchar', length: 10 })
  kind!: string;

  @Column({ type: 'varchar', length: 16 })
  prefix!: string;

  @Column({ type: 'char', length: 64 })
  secret_hash!: string;

  @Column({ type: 'uuid', nullable: true })
  pair_id!: string | null;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rotated_at!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  replaced_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  @ManyToOne(() => OAuthGrantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'grant_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_oauth_tokens_grant',
  })
  grant?: OAuthGrantEntity;
}
