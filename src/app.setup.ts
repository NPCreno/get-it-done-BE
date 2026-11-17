import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { WsAdapter } from '@nestjs/platform-ws';

/** Helmet, CORS, the global ValidationPipe and the WebSocket adapter. Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): void {
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
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
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
