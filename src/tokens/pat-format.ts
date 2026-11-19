import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { API_CONTRACT } from 'src/common/api-contract';

/**
 * Personal access token format (FEAT-07a): `gid_pat_<prefix>_<secret>`.
 * - prefix: 10 random base62 characters, stored in clear (lookup key, safe to
 *   show and log)
 * - secret: 32 random bytes as base64url (43 characters), stored only as its
 *   sha256 hex. 256 bits of entropy, so a fast hash is enough.
 * The `gid_pat_` marker lets secret scanners spot a leaked token.
 */
export const PAT_MARKER = API_CONTRACT.tokens.prefix;
export const PAT_PREFIX_LENGTH = 10;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PAT_RE = /^gid_pat_([0-9A-Za-z]{10})_([A-Za-z0-9_-]{43})$/;

export interface NewPat {
  /** The full token: shown once, never stored. */
  token: string;
  prefix: string;
  secretHash: string;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function newPrefix(): string {
  let out = '';
  for (let i = 0; i < PAT_PREFIX_LENGTH; i++) out += BASE62[randomInt(62)];
  return out;
}

export function generatePat(prefix: string = newPrefix()): NewPat {
  const secret = randomBytes(32).toString('base64url');
  return {
    token: `${PAT_MARKER}${prefix}_${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  };
}

/** Splits a token into its parts; null for anything that is not a PAT. */
export function parsePat(
  token: unknown,
): { prefix: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const m = PAT_RE.exec(token);
  return m ? { prefix: m[1], secret: m[2] } : null;
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(
    /^[0-9a-f]{64}$/.test(storedHash) ? storedHash : '',
    'hex',
  );
  if (b.length !== a.length) return false;
  return timingSafeEqual(a, b);
}
