import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { oauthUrls } from './oauth-config';
import { generateCode } from './oauth-format';
import {
  AuthorizeParams,
  isLoopbackHttp,
  OAuthScope,
  validateAuthorize,
  ValidAuthorize,
  withParams,
} from './oauth-params';
import { authorizeHttpError } from './oauth-errors';
import { OAuthClientsService } from './oauth-clients.service';

/** What the consent page shows (GET /api/oauth/authorize/check). */
export interface AuthorizeCheckDto {
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

  private async validate(p: AuthorizeParams): Promise<ValidAuthorize> {
    const client = await this.clients.find(p.client_id);
    const r = validateAuthorize(p, client, oauthUrls());
    if (!r.ok) throw authorizeHttpError(r);
    return r.value;
  }

  async check(p: AuthorizeParams): Promise<AuthorizeCheckDto> {
    const v = await this.validate(p);
    const url = new URL(v.redirectUri);
    return {
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
    const v = await this.validate(p);
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
