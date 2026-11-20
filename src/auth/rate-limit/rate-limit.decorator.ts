import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthThrottlerGuard } from './auth-throttler.guard';

export const RATE_LIMIT_GROUP = 'rate-limit:group';
export type RateLimitGroup =
  | 'login'
  | 'refresh'
  | 'logout'
  | 'signup'
  | 'chatMessage'
  | 'chatMember'
  | 'tokenCreate'
  | 'mcp'
  | 'oauthRegister'
  | 'oauthToken'
  | 'oauthAuthorize';

/** The only way a route is rate limited: there is no global guard. */
export const RateLimit = (group: RateLimitGroup) =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_GROUP, group),
    UseGuards(AuthThrottlerGuard),
  );
