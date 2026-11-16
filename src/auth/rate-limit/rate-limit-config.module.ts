import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  buildThrottlers,
  DEFAULT_RATE_LIMITS,
  RATE_LIMITS,
  RateLimitOverrides,
} from './rate-limits';

/** Holds the limits as a replaceable token (tests override it). */
@Module({
  providers: [{ provide: RATE_LIMITS, useValue: DEFAULT_RATE_LIMITS }],
  exports: [RATE_LIMITS],
})
export class RateLimitConfigModule {}

/**
 * Global so @RateLimit() works in any feature module. One in-memory store per
 * process: valid only while the API runs a single instance.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitConfigModule],
      inject: [RATE_LIMITS],
      useFactory: (limits: RateLimitOverrides) => ({
        throttlers: buildThrottlers(limits),
        errorMessage: 'Too many attempts. Please wait and try again.',
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
