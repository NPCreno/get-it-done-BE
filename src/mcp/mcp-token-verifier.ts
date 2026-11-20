import { Injectable, Logger } from '@nestjs/common';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { PAT_MARKER } from 'src/tokens/pat-format';
import { ACCESS_MARKER } from 'src/oauth/oauth-format';
import { OAuthGrantsService } from 'src/oauth/oauth-grants.service';
import { PatVerifier } from './pat-verifier';

export interface McpAuthExtra {
  userId: string;
  prefix: string;
  kind: 'pat' | 'oauth';
}

const invalid = () =>
  new OAuthError(
    OAuthErrorCode.InvalidToken,
    'Invalid, expired or revoked token',
  );

/**
 * The /mcp bearer verifier (FEAT-07c), dispatching by token marker:
 *  - `gid_pat_` -> personal access tokens (PatVerifier, unchanged)
 *  - `gid_oat_` -> OAuth access tokens: active, unexpired, grant active, user
 *    not deleted, issued for this resource
 *  - anything else (a website JWT included) -> invalid_token
 * `clientId` is the rate-limit key: the PAT id or the OAuth grant id.
 */
@Injectable()
export class McpTokenVerifier implements OAuthTokenVerifier {
  private readonly logger = new Logger('McpTokenVerifier');

  constructor(
    private readonly pats: PatVerifier,
    private readonly grants: OAuthGrantsService,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token.startsWith(PAT_MARKER)) {
      const info = await this.pats.verifyAccessToken(token);
      return { ...info, extra: { ...info.extra, kind: 'pat' } };
    }
    if (!token.startsWith(ACCESS_MARKER)) throw invalid();
    const v = await this.grants.verifyAccess(token);
    if (!v) throw invalid();
    try {
      await this.grants.touch(v);
    } catch (e) {
      // Usage tracking never blocks a request.
      this.logger.warn(
        `last_used_at update failed prefix=${v.prefix}: ${(e as Error).name}`,
      );
    }
    const extra: McpAuthExtra = {
      userId: v.userId,
      prefix: v.prefix,
      kind: 'oauth',
    };
    return {
      token,
      clientId: v.grantId,
      scopes: v.scopes,
      expiresAt: Math.floor(v.expiresAt.getTime() / 1000),
      extra: { ...extra },
    };
  }
}
