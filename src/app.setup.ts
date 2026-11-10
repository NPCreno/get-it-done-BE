import { INestApplication, ValidationPipe } from '@nestjs/common';

/** CORS plus the global ValidationPipe. Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): void {
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
