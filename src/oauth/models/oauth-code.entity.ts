import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { OAuthGrantEntity } from './oauth-grant.entity';

/**
 * An authorization code (FEAT-07c): only its sha256 is stored. 60 s, single
 * use, bound to the grant (client, user, scopes, resource), the redirect URI
 * and the PKCE challenge.
 */
@Entity('oauth_codes')
@Index('IDX_oauth_codes_grant', ['grant_id'])
export class OAuthCodeEntity {
  @PrimaryColumn({
    type: 'char',
    length: 64,
    primaryKeyConstraintName: 'PK_oauth_codes',
  })
  code_hash!: string;

  @Column({ type: 'uuid' })
  grant_id!: string;

  @Column({ type: 'varchar' })
  redirect_uri!: string;

  @Column({ type: 'varchar', length: 128 })
  code_challenge!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  @ManyToOne(() => OAuthGrantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'grant_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_oauth_codes_grant',
  })
  grant?: OAuthGrantEntity;
}
