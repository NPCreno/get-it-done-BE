import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';

/** The verified token identity (`sub`). Use instead of any client-sent user_id. */
export const AuthUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user.sub;
});
