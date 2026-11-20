import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { API_CONTRACT } from 'src/common/api-contract';
import { hashSecret, newPrefix } from 'src/tokens/pat-format';

/**
 * OAuth token formats (FEAT-07c), the same pattern as personal access tokens:
 * `<marker><prefix>_<secret>`, a 10-character base62 prefix (public lookup
 * key, safe to log) and a 32-byte base64url secret stored only as sha256 hex.
 *  - access token  `gid_oat_<prefix>_<secret>`
 *  - refresh token `gid_ort_<prefix>_<secret>`
 *  - client id     `gid_cli_<22 base64url chars>` (public, not a secret)
 *  - authorization code: 32 random bytes as base64url, stored as sha256 hex
 */
export const ACCESS_MARKER = API_CONTRACT.oauth.accessTokenPrefix;
export const REFRESH_MARKER = API_CONTRACT.oauth.refreshTokenPrefix;
export const CLIENT_MARKER = API_CONTRACT.oauth.clientIdPrefix;
export type OAuthTokenKind = 'access' | 'refresh';

const ACCESS_RE = /^gid_oat_([0-9A-Za-z]{10})_([A-Za-z0-9_-]{43})$/;
const REFRESH_RE = /^gid_ort_([0-9A-Za-z]{10})_([A-Za-z0-9_-]{43})$/;
const CLIENT_RE = /^gid_cli_[A-Za-z0-9_-]{22}$/;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
// RFC 7636 4.1: unreserved characters, 43 to 128 of them.
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export interface NewOpaqueToken {
  /** The full token: returned once, never stored. */
  token: string;
  prefix: string;
  secretHash: string;
}

export function generateToken(kind: OAuthTokenKind): NewOpaqueToken {
  const prefix = newPrefix();
  const secret = randomBytes(32).toString('base64url');
  const marker = kind === 'access' ? ACCESS_MARKER : REFRESH_MARKER;
  return {
    token: `${marker}${prefix}_${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  };
}

/** Splits an OAuth token into its parts; null for anything else. */
export function parseToken(
  token: unknown,
  kind: OAuthTokenKind,
): { prefix: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const m = (kind === 'access' ? ACCESS_RE : REFRESH_RE).exec(token);
  return m ? { prefix: m[1], secret: m[2] } : null;
}

export function generateClientId(): string {
  return `${CLIENT_MARKER}${randomBytes(16).toString('base64url')}`;
}

export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_RE.test(value);
}

export function generateCode(): { code: string; codeHash: string } {
  const code = randomBytes(32).toString('base64url');
  return { code, codeHash: hashSecret(code) };
}

/** The stored hash of a presented code; null when it cannot be a code. */
export function codeHashOf(code: unknown): string | null {
  return typeof code === 'string' && CODE_RE.test(code)
    ? hashSecret(code)
    : null;
}

/** PKCE S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Constant-time PKCE check; false for a malformed verifier. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return false;
  const a = Buffer.from(pkceS256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
