import { Request } from 'express';
import { getClientIp, hasValidInternalSecret } from '../client-ip';
import { normalizeIp } from './ip';

export type ClientKind = 'attested' | 'bff-noip' | 'unattested';
export interface ClientKey {
  kind: ClientKind;
  key: string;
}

/**
 * Who is calling, for rate limiting only (never an auth decision).
 *  1. attested: valid X-Internal-Secret and a usable X-Client-IP (SEC-04)
 *  2. bff-noip: valid secret but no usable IP: one shared bucket
 *  3. unattested: everything else. X-Client-IP is never read without the
 *     secret and X-Forwarded-For is never read at all. Railway's X-Real-IP is
 *     only a bounded fallback (a single valid IP), else the socket address.
 *
 * On Render (OPS-04) Render's docs list no X-Real-IP header, so unattested
 * callers normally fall back to the socket address, which is Render's proxy:
 * they share buckets. A caller that sends its own X-Real-IP picks its bucket,
 * so for unattested traffic the per-group global cap is the real limit.
 * Attested BFF traffic (login, signup, refresh) is unaffected.
 */
export function clientKey(req: Request): ClientKey {
  const ip = normalizeIp(getClientIp(req));
  if (ip) return { kind: 'attested', key: `ip:${ip}` };
  if (hasValidInternalSecret(req)) return { kind: 'bff-noip', key: 'bff-noip' };
  const real = req.headers['x-real-ip'];
  const xri = typeof real === 'string' ? normalizeIp(real) : null;
  if (xri) return { kind: 'unattested', key: `xri:${xri}` };
  const sock = normalizeIp(req.socket?.remoteAddress);
  return { kind: 'unattested', key: `sock:${sock ?? 'unknown'}` };
}
