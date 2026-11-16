import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { Response } from 'express';

/**
 * The one guard behind @RateLimit(group). Which throttlers run for a route is
 * decided by each throttler's skipIf (see rate-limits.ts), so a route only ever
 * pays for its own group's limits.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  private readonly auditLog = new Logger('rate-limit');

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    try {
      return await super.handleRequest(props);
    } catch (e) {
      // Name only: never the IP, identifier, key or tracker.
      if (e instanceof ThrottlerException) {
        this.auditLog.warn(`${props.throttler.name} blocked`);
      }
      throw e;
    }
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    // timeToBlockExpire is already in whole seconds (throttler.service.js)
    res.setHeader('Retry-After', String(Math.max(1, detail.timeToBlockExpire)));
    await super.throwThrottlingException(context, detail);
  }
}
