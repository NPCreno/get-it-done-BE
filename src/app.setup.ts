import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, NextFunction, Request, Response } from 'express';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** MCP tool calls may carry more than the default 100 kB JSON limit. */
export const MCP_BODY_LIMIT = '1mb';

/**
 * FEAT-07c: the routes MCP clients (browser-based ones included, like the MCP
 * Inspector) call cross-origin without credentials: OAuth discovery,
 * registration, token and revocation. Everything else, /api/oauth included,
 * keeps the website-only CORS.
 */
export function isPublicOAuthPath(path: string): boolean {
  return (
    path === '/.well-known/oauth-authorization-server' ||
    path === '/.well-known/oauth-protected-resource' ||
    path === '/.well-known/oauth-protected-resource/mcp' ||
    path === '/oauth/register' ||
    path === '/oauth/token' ||
    path === '/oauth/revoke'
  );
}

/** Helmet, CORS, the global ValidationPipe and the WebSocket adapter. Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): void {
  // Registered before Nest's own JSON parser (added at init), which then skips
  // the already-parsed body. Every other route keeps the 100 kB default. The
  // wrapper's name matters: Nest skips registering its parser when it finds a
  // layer named `jsonParser`, which would leave every other route unparsed.
  const mcpJson = json({ limit: MCP_BODY_LIMIT });
  app.use(
    '/mcp',
    function mcpJsonParser(req: Request, res: Response, next: NextFunction) {
      mcpJson(req, res, next);
    },
  );
  // JSON API: no HTML, no framing, no subresources. Not a replacement for the
  // frontend's own CSP. HSTS includeSubDomains stays off until the API
  // hostname is confirmed (a custom domain could cover other apps).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      strictTransportSecurity: {
        maxAge: 15552000,
        includeSubDomains: false,
        preload: false,
      },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  const siteCors: CorsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  };
  const publicCors: CorsOptions = {
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
    maxAge: 600,
  };
  app.enableCors(
    (req: Request, cb: (err: Error | null, options: CorsOptions) => void) =>
      cb(null, isPublicOAuthPath(req.path) ? publicCors : siteCors),
  );
  // Plain `ws` (the browser's built-in WebSocket); the chat gateway shares the HTTP port.
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
}
