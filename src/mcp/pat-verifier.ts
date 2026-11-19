import { Injectable, Logger } from '@nestjs/common';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { TokensService } from 'src/tokens/tokens.service';

/** Re-verified on every request, so a token without expiry gets a short one. */
const NO_EXPIRY_WINDOW_S = 60 * 60;

export interface PatAuthExtra {
  userId: string;
  prefix: string;
}

/**
 * Personal access tokens for `requireBearerAuth` (FEAT-07a). Anything that is
 * not a valid, active `gid_pat_` token (a website JWT included) is
 * `invalid_token`, which the SDK answers with 401 and `WWW-Authenticate:
 * Bearer`. The SDK refuses an AuthInfo without `expiresAt`, so it is always set.
 */
@Injectable()
export class PatVerifier implements OAuthTokenVerifier {
  private readonly logger = new Logger('PatVerifier');

  constructor(private readonly tokens: TokensService) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = await this.tokens.verify(token);
    if (!verified)
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        'Invalid, expired or revoked token',
      );
    try {
      await this.tokens.touch(verified.tokenId);
    } catch (e) {
      // Usage tracking never blocks a request.
      this.logger.warn(
        `last_used_at update failed prefix=${verified.prefix}: ${(e as Error).name}`,
      );
    }
    const expiresAt = verified.expiresAt
      ? Math.floor(verified.expiresAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000) + NO_EXPIRY_WINDOW_S;
    const extra: PatAuthExtra = {
      userId: verified.userId,
      prefix: verified.prefix,
    };
    return {
      token,
      clientId: verified.tokenId,
      scopes: ['mcp'],
      expiresAt,
      extra: { ...extra },
    };
  }
}
