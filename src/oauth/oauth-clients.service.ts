import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { generateClientId, isClientId } from './oauth-format';
import { KnownClient, validateRegistration } from './oauth-params';
import { OAuthHttpError } from './oauth-errors';

/** RFC 7591 response. Always a public client. */
export interface RegisteredClientDto {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
}

/**
 * OAuth clients (FEAT-07c), registered through DCR. Stores only the name and
 * the redirect URIs. Logs carry the public client id at most.
 */
@Injectable()
export class OAuthClientsService {
  private readonly logger = new Logger('oauth');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async register(body: unknown): Promise<RegisteredClientDto> {
    const r = validateRegistration(body);
    if (!r.ok) throw new OAuthHttpError(400, r.error, r.description);
    const clientId = generateClientId();
    const rows: { created_at: Date }[] = await this.dataSource.query(
      `INSERT INTO "oauth_clients" ("id", "client_id", "client_name", "redirect_uris")
       VALUES ($1, $2, $3, $4) RETURNING "created_at"`,
      [randomUUID(), clientId, r.value.client_name, r.value.redirect_uris],
    );
    this.logger.log(`client registered client=${clientId}`);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(
        new Date(rows[0].created_at).getTime() / 1000,
      ),
      client_name: r.value.client_name,
      redirect_uris: r.value.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /** The client for a public `gid_cli_` id, or null (a malformed id included). */
  async find(clientId: unknown): Promise<KnownClient | null> {
    if (!isClientId(clientId)) return null;
    const rows: KnownClient[] = await this.dataSource.query(
      `SELECT "id", "client_id", "client_name", "redirect_uris"
         FROM "oauth_clients" WHERE "client_id" = $1`,
      [clientId],
    );
    return rows[0] ?? null;
  }
}
