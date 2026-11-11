import { webcrypto } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateAuthEnv } from './auth/auth-env';
import { configureApp } from './app.setup';

// Ensure crypto is available globally
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

async function bootstrap() {
  validateAuthEnv();
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  const port = process.env.PORT ?? 8000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
