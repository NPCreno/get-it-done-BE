import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { LoginLockedException } from './login-attempts.service';

/** BUG-08: a locked account's 429 carries Retry-After in seconds. */
@Catch(LoginLockedException)
export class LoginLockedFilter implements ExceptionFilter {
  catch(exception: LoginLockedException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader(
      'Retry-After',
      String(Math.max(1, exception.retryAfterSeconds)),
    );
    res.status(exception.getStatus()).json(exception.getResponse());
  }
}
