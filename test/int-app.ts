import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { resetDatabase } from './int-db';

/** Boots the real AppModule with the same global pipe as production (configureApp). */
export async function createTestApp(): Promise<INestApplication> {
  await resetDatabase(BASE_URL, API_TEST_DB);
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
