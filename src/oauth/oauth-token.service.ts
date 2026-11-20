import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { secretMatches } from 'src/tokens/pat-format';
import { oauthUrls } from './oauth-config';
import {
  codeHashOf,
  generateToken,
  parseToken,
  pkceMatches,
} from './oauth-format';
import { KnownClient, parseScope, resourceMatches } from './oauth-params';
import {
  invalidClient,
  invalidGrant,
  invalidRequest,
  OAuthHttpError,
} from './oauth-errors';
import { OAuthClientsService } from './oauth-clients.service';
import { OAuthGrantsService } from './oauth-grants.service';

/** RFC 6749 5.1 token response. */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

type Body = Record<string, unknown>;
type Outcome =
  | { ok: true; value: TokenResponse }
  | { ok: false; error: OAuthHttpError };

const DAY_MS = 24 * 60 * 60 * 1000;
const O = API_CONTRACT.oauth;

/** A single string parameter, or undefined; repeated or non-string is an error. */
function param(body: Body, name: string): string | undefined {
  const v = body[name];
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string')
    throw invalidRequest(`${name} must be a single value`);
  return v;
}

function required(body: Body, name: string): string {
  const v = param(body, name);
  if (v === undefined) throw invalidRequest(`${name} is required`);
  return v;
}

interface GrantState {
  grant_id: string;
  grant_client: string;
  scopes: string[];
  grant_expires: Date;
  grant_revoked: Date | null;
  user_ok: boolean;
}

const grantUsable = (g: GrantState) =>
  !g.grant_revoked &&
  new Date(g.grant_expires).getTime() > Date.now() &&
  g.user_ok;

/**
 * The token and revocation endpoints (FEAT-07c), for public clients only
 * (client_id, no secret). Codes are single use and bound to PKCE, redirect
 * URI and client. Refresh tokens rotate; an old one presented again within 60
 * s while its replacement is still unused is treated as a retry. Any other
 * reuse, and any reused code, revokes the whole grant. Logs carry grant ids
 * and prefixes only, never a token, code, verifier or hash.
 */
@Injectable()
export class OAuthTokenService {
  private readonly logger = new Logger('oauth');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clients: OAuthClientsService,
    private readonly grants: OAuthGrantsService,
  ) {}

  async token(body: Body): Promise<TokenResponse> {
    const grantType = param(body, 'grant_type');
    if (grantType === undefined) throw invalidRequest('grant_type is required');
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token')
      throw new OAuthHttpError(
        400,
        'unsupported_grant_type',
        'grant_type must be authorization_code or refresh_token',
      );
    const client = await this.clients.find(required(body, 'client_id'));
    if (!client) throw invalidClient();
    const resource = param(body, 'resource');
    if (
      resource !== undefined &&
      !resourceMatches(resource, oauthUrls().resource)
    )
      throw new OAuthHttpError(
        400,
        'invalid_target',
        'resource is not this server',
      );
    const outcome =
      grantType === 'authorization_code'
        ? await this.exchangeCode(client, body)
        : await this.refresh(client, body);
    if (!outcome.ok) throw outcome.error;
    await this.dataSource.query(
      `UPDATE "oauth_clients" SET "last_used_at" = now() WHERE "id" = $1`,
      [client.id],
    );
    return outcome.value;
  }

  private async exchangeCode(
    client: KnownClient,
    body: Body,
  ): Promise<Outcome> {
    const codeHash = codeHashOf(required(body, 'code'));
    const verifier = required(body, 'code_verifier');
    const redirectUri = required(body, 'redirect_uri');
    if (!codeHash) return { ok: false, error: invalidGrant() };
    // Errors are returned, not thrown, so the code's used_at (and a reuse
    // revocation) commit.
    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const rows: (GrantState & {
        redirect_uri: string;
        code_challenge: string;
        expires_at: Date;
        used_at: Date | null;
      })[] = await m.query(
        `SELECT c."redirect_uri", c."code_challenge", c."expires_at", c."used_at",
                g."id" AS "grant_id", g."client_id" AS "grant_client", g."scopes",
                g."expires_at" AS "grant_expires", g."revoked_at" AS "grant_revoked",
                (u."user_id" IS NOT NULL) AS "user_ok"
           FROM "oauth_codes" c
           JOIN "oauth_grants" g ON g."id" = c."grant_id"
           LEFT JOIN "users" u ON u."user_id" = g."user_id" AND u."deletedAt" IS NULL
          WHERE c."code_hash" = $1
          FOR UPDATE OF c`,
        [codeHash],
      );
      const c = rows[0];
      if (!c) return { ok: false, error: invalidGrant() };
      if (c.used_at) {
        await this.grants.revokeGrant(m, c.grant_id, 'code-reuse');
        return { ok: false, error: invalidGrant() };
      }
      // Any attempt burns the code, so a verifier cannot be guessed.
      await m.query(
        `UPDATE "oauth_codes" SET "used_at" = now() WHERE "code_hash" = $1`,
        [codeHash],
      );
      if (
        c.grant_client !== client.id ||
        new Date(c.expires_at).getTime() <= Date.now() ||
        c.redirect_uri !== redirectUri ||
        !pkceMatches(verifier, c.code_challenge) ||
        !grantUsable(c)
      )
        return { ok: false, error: invalidGrant() };
      const issued = await this.issuePair(m, c);
      this.logger.log(
        `code exchanged grant=${c.grant_id} prefix=${issued.prefix}`,
      );
      return { ok: true, value: issued.response };
    });
  }

  private async refresh(client: KnownClient, body: Body): Promise<Outcome> {
    const parts = parseToken(required(body, 'refresh_token'), 'refresh');
    const scope = param(body, 'scope');
    if (!parts) return { ok: false, error: invalidGrant() };
    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const rows: (GrantState & {
        id: string;
        secret_hash: string;
        expires_at: Date;
        revoked_at: Date | null;
        rotated_at: Date | null;
        replaced_by: string | null;
      })[] = await m.query(
        `SELECT t."id", t."secret_hash", t."expires_at", t."revoked_at",
                t."rotated_at", t."replaced_by",
                g."id" AS "grant_id", g."client_id" AS "grant_client", g."scopes",
                g."expires_at" AS "grant_expires", g."revoked_at" AS "grant_revoked",
                (u."user_id" IS NOT NULL) AS "user_ok"
           FROM "oauth_tokens" t
           JOIN "oauth_grants" g ON g."id" = t."grant_id"
           LEFT JOIN "users" u ON u."user_id" = g."user_id" AND u."deletedAt" IS NULL
          WHERE t."prefix" = $1 AND t."kind" = 'refresh'
          FOR UPDATE OF t`,
        [parts.prefix],
      );
      const t = rows[0];
      if (!t || !secretMatches(parts.secret, t.secret_hash))
        return { ok: false, error: invalidGrant() };
      if (t.grant_client !== client.id) {
        await this.grants.revokeGrant(m, t.grant_id, 'refresh-wrong-client');
        return { ok: false, error: invalidGrant() };
      }
      if (!grantUsable(t)) return { ok: false, error: invalidGrant() };
      if (scope !== undefined) {
        const asked = parseScope(scope);
        if (!asked || !asked.every((s) => t.scopes.includes(s)))
          return {
            ok: false,
            error: new OAuthHttpError(
              400,
              'invalid_scope',
              'scope exceeds the grant',
            ),
          };
      }
      if (t.rotated_at) return this.retryOrRevoke(m, t);
      if (t.revoked_at || new Date(t.expires_at).getTime() <= Date.now())
        return { ok: false, error: invalidGrant() };
      const issued = await this.issuePair(m, t);
      await m.query(
        `UPDATE "oauth_tokens"
            SET "rotated_at" = now(), "revoked_at" = now(), "replaced_by" = $2,
                "used_at" = COALESCE("used_at", now())
          WHERE "id" = $1`,
        [t.id, issued.refreshId],
      );
      this.logger.log(
        `refresh rotated grant=${t.grant_id} prefix=${issued.prefix}`,
      );
      return { ok: true, value: issued.response };
    });
  }

  /**
   * A rotated refresh token came back. Within the grace window, with its
   * replacement never used, it is the client retrying a refresh whose answer
   * it lost: revoke the unused replacement pair and rotate again. Otherwise it
   * is a theft signal: revoke the grant.
   */
  private async retryOrRevoke(
    m: EntityManager,
    t: GrantState & {
      id: string;
      rotated_at: Date | null;
      replaced_by: string | null;
    },
  ): Promise<Outcome> {
    const age = Date.now() - new Date(t.rotated_at!).getTime();
    if (t.replaced_by && age <= O.refreshRetryGraceSeconds * 1000) {
      const next: {
        rotated_at: Date | null;
        revoked_at: Date | null;
        used_at: Date | null;
      }[] = await m.query(
        `SELECT "rotated_at", "revoked_at", "used_at" FROM "oauth_tokens"
            WHERE "id" = $1 FOR UPDATE`,
        [t.replaced_by],
      );
      const r = next[0];
      if (r && !r.rotated_at && !r.revoked_at && !r.used_at) {
        await m.query(
          `UPDATE "oauth_tokens" SET "revoked_at" = now()
            WHERE "id" = $1 OR "pair_id" = $1`,
          [t.replaced_by],
        );
        const issued = await this.issuePair(m, t);
        await m.query(
          `UPDATE "oauth_tokens" SET "replaced_by" = $2 WHERE "id" = $1`,
          [t.id, issued.refreshId],
        );
        this.logger.log(
          `refresh retried grant=${t.grant_id} prefix=${issued.prefix}`,
        );
        return { ok: true, value: issued.response };
      }
    }
    await this.grants.revokeGrant(m, t.grant_id, 'refresh-reuse');
    return { ok: false, error: invalidGrant() };
  }

  /** A new access + refresh pair, both capped at the grant's 180-day limit. */
  private async issuePair(
    m: EntityManager,
    g: GrantState,
  ): Promise<{ response: TokenResponse; refreshId: string; prefix: string }> {
    const now = Date.now();
    const end = new Date(g.grant_expires).getTime();
    const accessExp = Math.min(now + O.accessTokenSeconds * 1000, end);
    const refreshExp = Math.min(now + O.refreshTokenDays * DAY_MS, end);
    const access = generateToken('access');
    const refresh = generateToken('refresh');
    const refreshId = randomUUID();
    await m.query(
      `INSERT INTO "oauth_tokens"
         ("id", "grant_id", "kind", "prefix", "secret_hash", "pair_id", "expires_at")
       VALUES ($1, $2, 'refresh', $3, $4, NULL, $5),
              ($6, $2, 'access', $7, $8, $1, $9)`,
      [
        refreshId,
        g.grant_id,
        refresh.prefix,
        refresh.secretHash,
        new Date(refreshExp),
        randomUUID(),
        access.prefix,
        access.secretHash,
        new Date(accessExp),
      ],
    );
    return {
      refreshId,
      prefix: access.prefix,
      response: {
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: Math.max(1, Math.round((accessExp - now) / 1000)),
        refresh_token: refresh.token,
        scope: g.scopes.join(' '),
      },
    };
  }

  /**
   * RFC 7009. Always succeeds (the caller learns nothing). An access token
   * ends alone; a refresh token ends its whole grant. Only the token's own
   * client may revoke it.
   */
  async revoke(body: Body): Promise<void> {
    let token: string | undefined;
    let clientId: string | undefined;
    try {
      token = param(body, 'token');
      clientId = param(body, 'client_id');
    } catch {
      return;
    }
    if (!token || !clientId) return;
    const client = await this.clients.find(clientId);
    if (!client) return;
    const kind = parseToken(token, 'access')
      ? 'access'
      : parseToken(token, 'refresh')
        ? 'refresh'
        : null;
    if (!kind) return;
    const parts = parseToken(token, kind)!;
    await this.dataSource.transaction(async (m) => {
      const rows: {
        id: string;
        secret_hash: string;
        grant_id: string;
        client_id: string;
      }[] = await m.query(
        `SELECT t."id", t."secret_hash", t."grant_id", g."client_id"
             FROM "oauth_tokens" t JOIN "oauth_grants" g ON g."id" = t."grant_id"
            WHERE t."prefix" = $1 AND t."kind" = $2`,
        [parts.prefix, kind],
      );
      const row = rows[0];
      if (!row || row.client_id !== client.id) return;
      if (!secretMatches(parts.secret, row.secret_hash)) return;
      if (kind === 'refresh') {
        await this.grants.revokeGrant(m, row.grant_id, 'client-revoke');
        return;
      }
      await m.query(
        `UPDATE "oauth_tokens" SET "revoked_at" = COALESCE("revoked_at", now())
          WHERE "id" = $1`,
        [row.id],
      );
      this.logger.log(`access token revoked grant=${row.grant_id}`);
    });
  }
}
