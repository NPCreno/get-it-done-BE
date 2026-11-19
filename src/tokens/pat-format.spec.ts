import { createHash } from 'crypto';
import {
  generatePat,
  hashSecret,
  newPrefix,
  parsePat,
  secretMatches,
} from './pat-format';

describe('personal access token format (FEAT-07a)', () => {
  it('generates gid_pat_<10 base62>_<43 base64url> and hashes only the secret', () => {
    const pat = generatePat();
    expect(pat.token).toMatch(/^gid_pat_[0-9A-Za-z]{10}_[A-Za-z0-9_-]{43}$/);
    const parts = parsePat(pat.token)!;
    expect(parts.prefix).toBe(pat.prefix);
    expect(pat.secretHash).toBe(
      createHash('sha256').update(parts.secret).digest('hex'),
    );
    expect(pat.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pat.token).not.toContain(pat.secretHash);
  });

  it('prefixes and secrets are random', () => {
    const many = Array.from({ length: 200 }, () => generatePat());
    expect(new Set(many.map((p) => p.prefix)).size).toBe(200);
    expect(new Set(many.map((p) => p.token)).size).toBe(200);
    expect(newPrefix()).toMatch(/^[0-9A-Za-z]{10}$/);
  });

  it('parses only well-formed tokens', () => {
    const { token } = generatePat('AbCdEfGh12');
    expect(parsePat(token)?.prefix).toBe('AbCdEfGh12');
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'Bearer x',
      token.replace('gid_pat_', 'gid_xyz_'),
      token.slice(0, -1),
      token + 'A',
      token.replace('AbCdEfGh12', 'AbCdEfGh1!'),
      'gid_pat_AbCdEfGh12_' + 'a'.repeat(42) + '=',
      // a website JWT is not a PAT
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln',
      'gid_pat_' + 'A'.repeat(200),
    ]) {
      expect(parsePat(bad)).toBeNull();
    }
  });

  it('compares the secret with the stored hash', () => {
    const pat = generatePat();
    const { secret } = parsePat(pat.token)!;
    expect(secretMatches(secret, pat.secretHash)).toBe(true);
    expect(secretMatches(secret.slice(0, -1) + 'x', pat.secretHash)).toBe(
      secret.endsWith('x'),
    );
    expect(secretMatches(secret, hashSecret('other'))).toBe(false);
    expect(secretMatches(secret, '')).toBe(false);
    expect(secretMatches(secret, 'not-hex')).toBe(false);
  });
});
