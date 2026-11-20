import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { NextFunction, Request, Response } from 'express';
import { AuthModule } from 'src/auth/auth.module';
import { OAuthClientEntity } from './models/oauth-client.entity';
import { OAuthGrantEntity } from './models/oauth-grant.entity';
import { OAuthCodeEntity } from './models/oauth-code.entity';
import { OAuthTokenEntity } from './models/oauth-token.entity';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthPublicController } from './oauth-public.controller';
import { OAuthApiController } from './oauth-api.controller';
import { OAuthClientsService } from './oauth-clients.service';
import { OAuthAuthorizeService } from './oauth-authorize.service';
import { OAuthTokenService } from './oauth-token.service';
import { OAuthGrantsService } from './oauth-grants.service';
import { OAuthMaintenanceService } from './oauth-maintenance.service';

/** Every answer of these routes, errors included, is never cached. */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

/**
 * OAuth 2.1 authorization server for MCP connectors (FEAT-07c). Tokens it
 * issues work only on /mcp (McpTokenVerifier); AuthorizeGuard still accepts
 * only website JWTs.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      OAuthClientEntity,
      OAuthGrantEntity,
      OAuthCodeEntity,
      OAuthTokenEntity,
    ]),
  ],
  controllers: [
    OAuthMetadataController,
    OAuthPublicController,
    OAuthApiController,
  ],
  providers: [
    OAuthClientsService,
    OAuthAuthorizeService,
    OAuthTokenService,
    OAuthGrantsService,
    OAuthMaintenanceService,
  ],
  exports: [OAuthGrantsService],
})
export class OAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(noStore)
      .forRoutes(OAuthPublicController, OAuthApiController);
  }
}
