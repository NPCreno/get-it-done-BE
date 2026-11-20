import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { secretMatches } from 'src/tokens/pat-format';
import { oauthUrls } from './oauth-config';
import { parseToken } from './oauth-format';
import { resourceMatches } from './oauth-params';

/** "Connected apps" (40b). Never a token, hash or redirect URI. */
export interface GrantDto {
  id: string;
  client_name: string;
  redirect_host: string;
  created_at: string;
  last_used_at: string | null;
}

/** A verified OAuth access token, as the MCP verifier needs it. */
export interface VerifiedAccess {
  grantId: string;
  tokenId: string;
  /** The refresh token issued with this access token. */
  pairId: string | null;
  userId: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date;
}

interface GrantRow {
  id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: Date;
  last_used_at: Date | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GRANT_NOT_FOUND = 'Connected app not found';
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function hostOf(uris: string[]): string {
  try {
    return new URL(uris[0]).hostname;
  } catch {
    return '';
  }
}

export function toGrantDto(row: GrantRow): GrantDto {
  return {
    id: row.id,
    client_name: row.client_name,
    redirect_host: hostOf(row.redirect_uris),
    created_at: iso(row.created_at)!,
    last_used_at: iso(row.last_used_at),
  };
}

/**
 * OAuth grants (FEAT-07c): the list and revoke routes for the website, the
 * access-token check for /mcp, and the shared "revoke a grant" step. Logs
 * carry grant ids and token prefixes only.
 */
@Injectable()
export class OAuthGrantsService {
  private readonly logger = new Logger('oauth');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Grants that still work: not revoked, inside the 180-day limit, with an
   * active refresh token (so an abandoned consent never shows). Newest first.
   */
  async list(userId: string): Promise<GrantDto[]> {
    const rows: GrantRow[] = await this.dataSource.query(
      `SELECT g."id", c."client_name", c."redirect_uris", g."created_at", g."last_used_at"
         FROM "oauth_grants" g
         JOIN "oauth_clients" c ON c."id" = g."client_id"
        WHERE g."user_id" = $1 AND g."revoked_at" IS NULL AND g."expires_at" > now()
          AND EXISTS (SELECT 1 FROM "oauth_tokens" t
                       WHERE t."grant_id" = g."id" AND t."kind" = 'refresh'
                         AND t."revoked_at" IS NULL AND t."expires_at" > now())
        ORDER BY g."created_at" DESC, g."id"`,
      [userId],
    );
    return rows.map(toGrantDto);
  }

  /** Revokes the grant and every token of it. Idempotent; foreign = 404. */
  async revoke(userId: string, id: string): Promise<GrantDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException(GRANT_NOT_FOUND);
    return this.dataSource.transaction(async (m) => {
      const rows: GrantRow[] = await m.query(
        `SELECT g."id", c."client_name", c."redirect_uris", g."created_at", g."last_used_at"
           FROM "oauth_grants" g
           JOIN "oauth_clients" c ON c."id" = g."client_id"
          WHERE g."id" = $1 AND g."user_id" = $2
          FOR UPDATE OF g`,
        [id, userId],
      );
      if (rows.length === 0) throw new NotFoundException(GRANT_NOT_FOUND);
      await this.revokeGrant(m, id, 'user');
      return toGrantDto(rows[0]);
    });
  }

  /** Ends a grant: the grant row and all its tokens. */
  async revokeGrant(
    m: EntityManager,
    grantId: string,
    reason: string,
  ): Promise<void> {
    await m.query(
      `UPDATE "oauth_grants" SET "revoked_at" = COALESCE("revoked_at", now())
        WHERE "id" = $1`,
      [grantId],
    );
    await m.query(
      `UPDATE "oauth_tokens" SET "revoked_at" = COALESCE("revoked_at", now())
        WHERE "grant_id" = $1`,
      [grantId],
    );
    const log = `grant revoked grant=${grantId} reason=${reason}`;
    if (reason === 'user' || reason === 'client-revoke') this.logger.log(log);
    else this.logger.warn(log);
  }

  /**
   * The owner of an OAuth access token if it is well-formed, known, active and
   * unexpired, its grant is active, its user exists and is not deleted, and it
   * was issued for this server's resource; otherwise null. Constant-time hash
   * comparison.
   */
  async verifyAccess(token: string): Promise<VerifiedAccess | null> {
    const parts = parseToken(token, 'access');
    if (!parts) return null;
    const rows: {
      id: string;
      pair_id: string | null;
      prefix: string;
      secret_hash: string;
      expires_at: Date;
      grant_id: string;
      user_id: string;
      scopes: string[];
      resource: string;
    }[] = await this.dataSource.query(
      `SELECT t."id", t."pair_id", t."prefix", t."secret_hash", t."expires_at",
              g."id" AS "grant_id", g."user_id", g."scopes", g."resource"
         FROM "oauth_tokens" t
         JOIN "oauth_grants" g ON g."id" = t."grant_id"
              AND g."revoked_at" IS NULL AND g."expires_at" > now()
         JOIN "users" u ON u."user_id" = g."user_id" AND u."deletedAt" IS NULL
        WHERE t."prefix" = $1 AND t."kind" = 'access'
          AND t."revoked_at" IS NULL AND t."expires_at" > now()`,
      [parts.prefix],
    );
    const row = rows[0];
    if (!row || !secretMatches(parts.secret, row.secret_hash)) return null;
    if (!resourceMatches(row.resource, oauthUrls().resource)) return null;
    return {
      grantId: row.grant_id,
      tokenId: row.id,
      pairId: row.pair_id,
      userId: row.user_id,
      prefix: row.prefix,
      scopes: row.scopes,
      expiresAt: new Date(row.expires_at),
    };
  }

  /**
   * Records use: the grant's last_used_at at most once a minute, and the first
   * use of the access token and of its refresh pair (the retry grace needs to
   * know whether a replacement pair was ever used). One statement.
   */
  async touch(v: VerifiedAccess): Promise<void> {
    await this.dataSource.query(
      `WITH g AS (
         UPDATE "oauth_grants" SET "last_used_at" = now()
          WHERE "id" = $1
            AND ("last_used_at" IS NULL OR "last_used_at" < now() - interval '1 minute')
         RETURNING 1),
       t AS (
         UPDATE "oauth_tokens" SET "used_at" = now()
          WHERE "id" = ANY($2::uuid[]) AND "used_at" IS NULL
         RETURNING 1)
       SELECT 1`,
      [v.grantId, v.pairId ? [v.tokenId, v.pairId] : [v.tokenId]],
    );
  }
}
