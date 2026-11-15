import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';

/** The verified token's expiry in epoch milliseconds, or undefined. */
export const TokenExp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const exp = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user.exp;
    return typeof exp === 'number' ? exp * 1000 : undefined;
  },
);
