import { Request } from 'express';
import { isIP } from 'net';
import { safeEqual } from './token-crypto';

const MAX_IP_LENGTH = 64;

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? '';
}

/**
 * Client IP for audit records only. Never use it for an auth decision.
 *
 * The browser calls this API directly, so any caller can send `X-Client-IP`.
 * It is trusted only when `X-Internal-Secret` matches `INTERNAL_API_SECRET`
 * (sent by our Next.js BFF). Otherwise the IP is unknown (`null`): recording
 * nothing beats recording an unverified value. The secret is not an auth
 * control; endpoints never require it.
 */
export function getClientIp(req: Request): string | null {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return null;
  const provided = headerValue(req.headers['x-internal-secret']);
  if (!provided || !safeEqual(provided, expected)) return null;
  const ip = headerValue(req.headers['x-client-ip']);
  if (!ip || ip.length > MAX_IP_LENGTH || isIP(ip) === 0) return null;
  return ip;
}
