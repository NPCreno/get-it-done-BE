import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { TokensModule } from 'src/tokens/tokens.module';
import { TaskModule } from 'src/task/task.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { UserModule } from 'src/user/user.module';
import { ChatModule } from 'src/chat/chat.module';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';
import { PatVerifier } from './pat-verifier';
import { mcpOriginCheck, parseAllowedOrigins } from './mcp-origin';

/**
 * MCP server, phase 1 (FEAT-07a): POST /mcp with a personal access token.
 * Order: Origin check (403) -> requireBearerAuth (401, `WWW-Authenticate:
 * Bearer`, no resource_metadata until phase 2's OAuth) -> rate limit (429) ->
 * the SDK handler. Personal access tokens are accepted nowhere else.
 */
@Module({
  imports: [
    TokensModule,
    TaskModule,
    ProjectsModule,
    NotificationsModule,
    UserModule,
    ChatModule,
  ],
  controllers: [McpController],
  providers: [PatVerifier, McpServerFactory],
})
export class McpModule implements NestModule {
  constructor(private readonly verifier: PatVerifier) {}

  configure(consumer: MiddlewareConsumer): void {
    // Validated at boot by env.validation (an invalid list fails startup).
    const { origins } = parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS);
    consumer
      .apply(
        mcpOriginCheck(origins),
        requireBearerAuth({ verifier: this.verifier, requiredScopes: ['mcp'] }),
      )
      .forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
