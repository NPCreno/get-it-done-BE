import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { TokensModule } from 'src/tokens/tokens.module';
import { OAuthModule } from 'src/oauth/oauth.module';
import { oauthUrls } from 'src/oauth/oauth-config';
import { TaskModule } from 'src/task/task.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { UserModule } from 'src/user/user.module';
import { ChatModule } from 'src/chat/chat.module';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';
import { PatVerifier } from './pat-verifier';
import { McpTokenVerifier } from './mcp-token-verifier';
import { mcpOriginCheck, parseAllowedOrigins } from './mcp-origin';

/**
 * MCP server (FEAT-07a), with OAuth for connectors (FEAT-07c): POST /mcp with
 * a personal access token or an OAuth access token. Order: Origin check (403)
 * -> requireBearerAuth (401 with `WWW-Authenticate: Bearer error=...,
 * scope="mcp", resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"`)
 * -> rate limit (429) -> the SDK handler. These tokens are accepted nowhere else.
 */
@Module({
  imports: [
    TokensModule,
    OAuthModule,
    TaskModule,
    ProjectsModule,
    NotificationsModule,
    UserModule,
    ChatModule,
  ],
  controllers: [McpController],
  providers: [PatVerifier, McpTokenVerifier, McpServerFactory],
})
export class McpModule implements NestModule {
  constructor(private readonly verifier: McpTokenVerifier) {}

  configure(consumer: MiddlewareConsumer): void {
    // Validated at boot by env.validation (an invalid list fails startup).
    const { origins } = parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS);
    consumer
      .apply(mcpOriginCheck(origins), this.bearer())
      .forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }

  /** The metadata URL follows the issuer (read per request, built once per value). */
  private bearer(): RequestHandler {
    let url = '';
    let handler: RequestHandler | null = null;
    return (req: Request, res: Response, next: NextFunction) => {
      const current = oauthUrls().resourceMetadata;
      if (!handler || current !== url) {
        url = current;
        handler = requireBearerAuth({
          verifier: this.verifier,
          requiredScopes: ['mcp'],
          resourceMetadataUrl: url,
        });
      }
      return handler(req, res, next);
    };
  }
}
