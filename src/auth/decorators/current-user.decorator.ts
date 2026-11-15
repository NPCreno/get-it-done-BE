import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';
import { User } from 'src/user/models/user.interface';

/**
 * The verified token's user claim (role etc.), never the database row.
 * Use `@AuthUserId()` for the id; use this only when a role is needed.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user.user;
  },
);
