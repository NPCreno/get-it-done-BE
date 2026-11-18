import { createHash } from 'crypto';
import { isEmailLike, normalizeEmail } from '../../user/identifier';

/**
 * Bucket key for the login identifier, exactly as the lookup sees it,
 * namespaced by the field findByEmailOrUsername will use. An email is
 * normalized the same way the lookup normalizes it (normalizeEmail: trimmed,
 * lower-cased), so capitalizations of one email share one bucket (BUG-01). A
 * username is looked up exactly, so it is hashed as sent: no case folding, no
 * trimming. Null (throttler skipped) when there is no usable identifier; the
 * guard runs before the ValidationPipe, so this checks defensively.
 */
export function identifierKey(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const value = b.email ?? b.username;
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    return null;
  }
  const key = isEmailLike(value) ? 'e:' + normalizeEmail(value) : 'u:' + value;
  return `id:${createHash('sha256').update(key).digest('hex')}`;
}
