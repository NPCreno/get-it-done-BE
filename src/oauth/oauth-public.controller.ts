import { Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import { OAuthExceptionFilter } from './oauth-errors';
import { OAuthClientsService } from './oauth-clients.service';
import { OAuthTokenService } from './oauth-token.service';

/**
 * The OAuth endpoints MCP clients call directly (FEAT-07c): DCR (JSON), token
 * and revocation (form-encoded). Public clients only, CORS `*` without
 * credentials (app.setup.ts), `Cache-Control: no-store` on every answer
 * (OAuthModule middleware), RFC 6749 error bodies (OAuthExceptionFilter).
 * Bodies are documented inline types validated by hand in the services: an
 * OAuth error must keep the RFC shape, not the ValidationPipe's.
 */
@UseFilters(OAuthExceptionFilter)
@Controller('oauth')
export class OAuthPublicController {
  constructor(
    private readonly clients: OAuthClientsService,
    private readonly tokens: OAuthTokenService,
  ) {}

  /** RFC 7591 body: `{ redirect_uris, client_name?, grant_types?, response_types? }`. */
  @RateLimit('oauthRegister')
  @Post('register')
  @HttpCode(201)
  register(@Body() body: Record<string, unknown>) {
    return this.clients.register(body);
  }

  /** `grant_type`, `client_id`, and `code`/`code_verifier`/`redirect_uri` or `refresh_token`. */
  @RateLimit('oauthToken')
  @Post('token')
  @HttpCode(200)
  token(@Body() body: Record<string, unknown>) {
    return this.tokens.token(body ?? {});
  }

  /** RFC 7009 body: `token`, `client_id`, `token_type_hint?`. Always 200. */
  @RateLimit('oauthToken')
  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: Record<string, unknown>): Promise<void> {
    await this.tokens.revoke(body ?? {});
  }
}
