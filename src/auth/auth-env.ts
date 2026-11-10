import { Logger } from '@nestjs/common';

/** Fail closed at startup if a required auth secret is missing. */
export function validateAuthEnv(): void {
  const missing = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ACCESS_EXPIRATION'].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!process.env.INTERNAL_API_SECRET) {
    new Logger('AuthEnv').warn(
      'INTERNAL_API_SECRET is not set: client IPs will not be recorded.',
    );
  }
}
