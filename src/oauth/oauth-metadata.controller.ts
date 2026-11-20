import { Controller, Get, Header } from '@nestjs/common';
import {
  authorizationServerMetadata,
  oauthUrls,
  protectedResourceMetadata,
} from './oauth-config';

const CACHE = 'public, max-age=300';

/**
 * OAuth discovery (FEAT-07c): RFC 9728 protected-resource metadata (path-aware
 * and root form) and RFC 8414 authorization-server metadata. No database, so
 * they answer fast right after a cold start. CORS `*` (app.setup.ts).
 */
@Controller('.well-known')
export class OAuthMetadataController {
  @Get('oauth-protected-resource/mcp')
  @Header('Cache-Control', CACHE)
  resourceForMcp() {
    return protectedResourceMetadata(oauthUrls());
  }

  @Get('oauth-protected-resource')
  @Header('Cache-Control', CACHE)
  resource() {
    return protectedResourceMetadata(oauthUrls());
  }

  @Get('oauth-authorization-server')
  @Header('Cache-Control', CACHE)
  authorizationServer() {
    return authorizationServerMetadata(oauthUrls());
  }
}
