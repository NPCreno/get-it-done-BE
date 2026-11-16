import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/** Helmet, CORS and the global ValidationPipe. Shared by main.ts and the integration tests. */
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
