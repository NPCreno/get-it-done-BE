import { createHash } from 'crypto';
import { isEmailLike } from '../../user/identifier';

/**
 * Bucket key for the login identifier, exactly as the lookup sees it: no case
 * folding, no trimming, namespaced by the field findByEmailOrUsername will use.
 * Null (throttler skipped) when there is no usable identifier; the guard runs
 * before the ValidationPipe, so this checks defensively.
 */
export function identifierKey(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const value = b.email ?? b.username;
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    return null;
  }
  const ns = isEmailLike(value) ? 'e:' : 'u:';
  return `id:${createHash('sha256')
    .update(ns + value)
    .digest('hex')}`;
}
