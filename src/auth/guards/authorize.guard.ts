import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from '../Interfaces/authenticatedRequest';

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

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired token.',
      });
    }
    // A refresh token must never pass as an access token.
    if (payload?.type !== 'access') {
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
