import { randomUUID } from 'crypto';

/**
 * Business ids (REF-14b): `<prefix>-<uuid v4>`, for example
 * `task-3f2b...`. Collision-proof without a lookup; the unique constraint on
 * each id column is the final guard. Old rows keep their old ids
 * (`task-123456789`, `TMP-<ms>-<n>`, ...), so nothing may parse an id's
 * format: ids are opaque strings.
 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
