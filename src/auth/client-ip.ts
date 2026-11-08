import { Request } from 'express';

const MAX_IP_LENGTH = 64;

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? '';
}

/**
 * Client IP for audit records only. Never use it for an auth decision.
 *
 * `X-Client-IP` is set by our Next.js BFF from the Vercel-provided client IP.
 * `X-Real-IP` is set by Railway's proxy for direct requests.
 * `X-Forwarded-For` is deliberately not read: Railway does not document how it
 * treats a client-supplied value.
 */
export function getClientIp(req: Request): string {
  const ip =
    firstHeaderValue(req.headers['x-client-ip']) ||
    firstHeaderValue(req.headers['x-real-ip']) ||
    req.ip ||
    '';
  return ip.slice(0, MAX_IP_LENGTH);
}
