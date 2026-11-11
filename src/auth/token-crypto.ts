import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/** Hex SHA-256 of a refresh token. Stored instead of the token itself. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison (digests first, so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

function replayKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, 'gid', 'refresh-replay-v1', 32),
  );
}

/**
 * AES-256-GCM. Format: `v1.<iv>.<tag>.<ct>` (base64url).
 * Key derives from JWT_REFRESH_SECRET, so rotating the secret invalidates
 * every refresh token and every stored replay at once.
 */
export function encryptReplay(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', replayKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export function decryptReplay(payload: string, secret: string): string | null {
  try {
    const [v, iv, tag, ct] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      replayKey(secret),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
