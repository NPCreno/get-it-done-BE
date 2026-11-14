import {
  CanActivate,
  ExecutionContext,
  Injectable,
  mixin,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';

export const NOT_YOUR_DATA = 'Access denied: Not your data.';

/**
 * The single place a client-sent id is compared with the token identity.
 * Allows the request when `req.params[param]` equals the token `sub`, or (with
 * `allowAdmin`) when the token's role is admin. It must run after
 * `AuthorizeGuard`: `@UseGuards(AuthorizeGuard, SelfParam('user_id'))`. A
 * missing `req.user` fails closed.
 */
export function SelfParam(
  param: string,
  opts: { allowAdmin?: boolean } = {},
): Type<CanActivate> {
  @Injectable()
  class SelfParamGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const sub = req.user?.sub;
      const target = req.params?.[param];
      if (typeof sub !== 'string' || sub === '') {
        throw new UnauthorizedException(NOT_YOUR_DATA);
      }
      if (typeof target === 'string' && target === sub) return true;
      if (opts.allowAdmin && req.user.user?.role === 'admin') return true;
      throw new UnauthorizedException(NOT_YOUR_DATA);
    }
  }
  return mixin(SelfParamGuard);
}
