import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from './Interfaces/tokenPayload';

/**
 * The one access-token check, shared by AuthorizeGuard (HTTP) and the chat
 * gateway (WebSocket): signature and expiry with JWT_SECRET, and
 * `type === 'access'` so a refresh token never passes. Null when invalid.
 */
export async function verifyAccessToken(
  jwtService: JwtService,
  token: unknown,
): Promise<TokenPayload | null> {
  if (typeof token !== 'string' || token === '') return null;
  let payload: TokenPayload;
  try {
    payload = await jwtService.verifyAsync<TokenPayload>(token);
  } catch {
    return null;
  }
  if (payload?.type !== 'access') return null;
  if (typeof payload.sub !== 'string' || payload.sub === '') return null;
  return payload;
}
