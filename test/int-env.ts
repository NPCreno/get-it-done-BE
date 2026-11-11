/**
 * Side-effect module: import it FIRST. AppModule reads process.env while its
 * decorators are evaluated, so the environment must be set before it loads.
 */
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRATION = '15m';
process.env.REFRESH_REUSE_GRACE_SECONDS = '30';
process.env.FRONTEND_URL = 'http://localhost:3000';
delete process.env.JWT_REFRESH_EXPIRATION;
delete process.env.JWT_REFRESH_EXPIRATION_SHORT;

export const BASE_URL =
  process.env.TEST_DATABASE_URL_BASE ??
  'postgresql://postgres:dev@localhost:5433';
export const API_TEST_DB = 'getitdone_test_api';

process.env.DATABASE_URL = `${BASE_URL}/${API_TEST_DB}`;
process.env.DATABASE_SYNCHRONIZE = 'true';
