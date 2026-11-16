import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { resetDatabase } from './int-db';
import type { RateLimitOverrides } from '../src/auth/rate-limit/rate-limits';

/** Boots the real AppModule with the same global pipe as production (configureApp). */
export async function createTestApp(
  limits?: RateLimitOverrides,
): Promise<INestApplication> {
  await resetDatabase(BASE_URL, API_TEST_DB);
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const { RATE_LIMITS, THROTTLER_DEFS } = await import(
    '../src/auth/rate-limit/rate-limits'
  );
  // Existing suites sign up and log in over HTTP repeatedly: high limits by
  // default. The rate-limit suite passes `{}` to get the real defaults.
  const high = Object.fromEntries(
    THROTTLER_DEFS.map((d) => [d.name, { limit: 1_000_000 }]),
  );
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RATE_LIMITS)
    .useValue(limits ?? high)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
