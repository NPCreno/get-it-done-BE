import { isIP } from 'net';
import { normalizeIp as normalizeWithPrefix } from '@nestjs/throttler';

const MAX_IP_LENGTH = 64;

/**
 * Canonical client key: IPv4 as is, IPv4-mapped IPv6 as dotted IPv4, other
 * IPv6 masked to its /64. Anything that is not an IP is `null` (never a key).
 */
export function normalizeIp(ip: unknown): string | null {
  if (typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed || trimmed.length > MAX_IP_LENGTH) return null;
  if (isIP(trimmed.split('%')[0]) === 0) return null;
  return normalizeWithPrefix(trimmed, 64);
}
