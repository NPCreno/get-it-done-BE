import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { oauthUrls } from './oauth-config';
import { generateCode } from './oauth-format';
import {
  AuthorizeParams,
  AuthorizeResult,
  isLoopbackHttp,
  OAuthScope,
  validateAuthorize,
  ValidAuthorize,
  withParams,
} from './oauth-params';
import { authorizeHttpError } from './oauth-errors';
import { OAuthClientsService } from './oauth-clients.service';

/**
 * GET /api/oauth/authorize/check: always 200, a union on `outcome` (the FE's
 * API client keeps only `message` from a non-2xx body).
 *  - ok: what the consent page shows
 *  - redirect: send the browser to `redirect_to` (it carries `error=`, `state`, `iss`)
 *  - fatal: show an error, never redirect (unknown client, unregistered redirect URI)
 */
export type AuthorizeCheckDto =
  | ({ outcome: 'ok' } & AuthorizeCheckOk)
  | { outcome: 'redirect'; error: string; redirect_to: string }
  | { outcome: 'fatal'; error: string };

export interface AuthorizeCheckOk {
  client_name: string;
  /** The host the user is sent back to, e.g. claude.ai or localhost. */
  redirect_host: string;
  /** True when that is a loopback address: an app on the user's computer. */
  loopback_only: boolean;
  scopes: OAuthScope[];
}

export interface AuthorizeDecisionDto {
  redirect_to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The authorization endpoint's server side (FEAT-07c). The page lives on the
 * website (it holds the session); it calls check, shows the consent screen,
 * then posts the decision with the website JWT. The decision re-validates
 * every parameter: the check's result is never trusted.
 */
@Injectable()
export class OAuthAuthorizeService {
  private readonly logger = new Logger('oauth');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clients: OAuthClientsService,
  ) {}

  private async validate(p: AuthorizeParams): Promise<AuthorizeResult> {
    const client = await this.clients.find(p.client_id);
    return validateAuthorize(p, client, oauthUrls());
  }

  async check(p: AuthorizeParams): Promise<AuthorizeCheckDto> {
    const r = await this.validate(p);
    if (!r.ok)
      return r.fatal
        ? { outcome: 'fatal', error: r.error }
        : { outcome: 'redirect', error: r.error, redirect_to: r.redirectTo };
    const v: ValidAuthorize = r.value;
    const url = new URL(v.redirectUri);
    return {
      outcome: 'ok',
      client_name: v.client.client_name,
      redirect_host: url.hostname,
      loopback_only: isLoopbackHttp(url),
      scopes: v.scopes,
    };
  }

  async decide(
    userId: string,
    p: AuthorizeParams,
    decision: 'allow' | 'deny',
  ): Promise<AuthorizeDecisionDto> {
    // Re-validated from scratch. Fatal: 400 (show, never redirect). Any other
    // problem goes back to the client through its redirect URI, like a deny.
    const r = await this.validate(p);
    if (!r.ok) {
      if (r.fatal) throw authorizeHttpError(r);
      return { redirect_to: r.redirectTo };
    }
    const v = r.value;
    const { issuer } = oauthUrls();
    if (decision === 'deny')
      return {
        redirect_to: withParams(v.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied access.',
          state: v.state,
          iss: issuer,
        }),
      };
    const users: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "users" WHERE "user_id" = $1 AND "deletedAt" IS NULL`,
      [userId],
    );
    if (users.length === 0) throw new UnauthorizedException();
    const grantId = randomUUID();
    const { code, codeHash } = generateCode();
    const now = Date.now();
    await this.dataSource.transaction(async (m) => {
      await m.query(
        `INSERT INTO "oauth_grants"
           ("id", "user_id", "client_id", "scopes", "resource", "expires_at")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          grantId,
          userId,
          v.client.id,
          v.scopes,
          v.resource,
          new Date(now + API_CONTRACT.oauth.grantMaxDays * DAY_MS),
        ],
      );
      await m.query(
        `INSERT INTO "oauth_codes"
           ("code_hash", "grant_id", "redirect_uri", "code_challenge", "expires_at")
         VALUES ($1, $2, $3, $4, $5)`,
        [
          codeHash,
          grantId,
          v.redirectUri,
          v.codeChallenge,
          new Date(now + API_CONTRACT.oauth.codeSeconds * 1000),
        ],
      );
    });
    this.logger.log(
      `grant created grant=${grantId} client=${v.client.client_id}`,
    );
    return {
      redirect_to: withParams(v.redirectUri, {
        code,
        state: v.state,
        iss: issuer,
      }),
    };
  }
}
