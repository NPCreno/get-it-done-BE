import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthorizeError } from './oauth-params';

/** An RFC 6749 error response: `{ error, error_description }`. */
export class OAuthHttpError extends HttpException {
  constructor(status: number, error: string, description: string) {
    super({ error, error_description: description }, status);
  }
}

export const invalidRequest = (d: string) =>
  new OAuthHttpError(400, 'invalid_request', d);
export const invalidGrant = (d = 'The grant is invalid, expired or revoked.') =>
  new OAuthHttpError(400, 'invalid_grant', d);
export const invalidClient = () =>
  new OAuthHttpError(401, 'invalid_client', 'Unknown client.');

/**
 * The consent page's error (GET /api/oauth/authorize/check and the decision):
 * 400 `{ statusCode, error, message, fatal, redirect_to? }`. Fatal: show it,
 * never redirect. Not fatal: `redirect_to` carries `error=` for the client.
 */
export function authorizeHttpError(e: AuthorizeError): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: e.error,
    message: e.description,
    fatal: e.fatal,
    ...(e.fatal ? {} : { redirect_to: e.redirectTo }),
  });
}

/**
 * The /oauth/* routes answer every error in RFC 6749 shape, including the
 * rate limiter's 429 (its Retry-After header is already set).
 */
@Catch()
export class OAuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('oauth');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as Record<string, unknown> | string;
      if (
        typeof body === 'object' &&
        typeof body.error === 'string' &&
        'error_description' in body
      ) {
        res.status(status).json(body);
        return;
      }
      if (status === 429) {
        res.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Too many requests. Please wait and try again.',
        });
        return;
      }
      if (status < 500) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'The request is malformed.',
        });
        return;
      }
    }
    this.logger.error(
      'oauth endpoint failed',
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({
      error: 'server_error',
      error_description: 'Something went wrong.',
    });
  }
}
