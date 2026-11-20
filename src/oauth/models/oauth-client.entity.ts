import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';

/**
 * An OAuth client registered through DCR (FEAT-07c). Always public (no
 * secret). `client_id` is the public `gid_cli_...` identifier; `id` is the
 * internal key the grants reference. Names match migration 1763500000000-OAuth.
 */
@Entity('oauth_clients')
@Unique('UQ_oauth_clients_client_id', ['client_id'])
export class OAuthClientEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_oauth_clients' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  client_id!: string;

  @Column({ type: 'varchar', length: API_CONTRACT.oauth.clientNameMax })
  client_name!: string;

  @Column({ type: 'text', array: true })
  redirect_uris!: string[];

  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_used_at!: Date | null;
}
