import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';

/** Allows only a token whose role is admin. Run it after `AuthorizeGuard`. */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user?.user?.role !== 'admin') {
      throw new UnauthorizedException('Access denied: Admin only.');
    }
    return true;
  }
}
