import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';
import { verifyAccessToken } from '../verify-access-token';

@Injectable()
export class AuthorizeGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: AuthenticatedRequest = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'TOKEN_MISSING',
        message: 'Bearer token not provided.',
      });
    }

    const token = authHeader.split(' ')[1];
    // Signature, expiry, and type === 'access' (a refresh token never passes).
    const payload = await verifyAccessToken(this.jwtService, token);
    if (!payload) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired token.',
      });
    }
    request['user'] = payload;
    return true;
  }
}
