import 'dotenv/config';
import { webcrypto } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup';
import { formatEnvErrors, validateEnv } from './config/env.validation';

// Ensure crypto is available globally
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

async function bootstrap() {
  // Validate before AppModule is loaded: its decorators (TypeOrmModule.forRoot,
  // JwtModule) read process.env when they are evaluated.
  const { env, errors, warnings } = validateEnv(process.env);
  if (errors.length > 0) {
    console.error(formatEnvErrors(errors));
    process.exit(1);
  }
  for (const w of warnings) console.warn(`[Env] warning: ${w}`);
  console.log(`[Env] configuration valid (NODE_ENV=${env.NODE_ENV})`);

  const { AppModule } = await import('./app.module');
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
