import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type { DataSource } from 'typeorm';
import { TokensService, tokenStatus } from 'src/tokens/tokens.service';
import { generatePat } from 'src/tokens/pat-format';
import { PatVerifier } from './pat-verifier';

const HOUR = 3600_000;

/** TokensService over a fake DataSource: the lookup returns `row` (or nothing). */
function setup(row: Record<string, unknown> | null) {
  const queries: string[] = [];
  const ds = {
    query: jest.fn((sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT')) return Promise.resolve(row ? [row] : []);
      return Promise.resolve([[], 1]);
    }),
  } as unknown as DataSource;
  const verifier = new PatVerifier(new TokensService(ds));
  return { verifier, queries };
}

function rowFor(
  pat: ReturnType<typeof generatePat>,
  over: Record<string, unknown> = {},
) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'USR-1',
    prefix: pat.prefix,
    secret_hash: pat.secretHash,
    expires_at: new Date(Date.now() + 30 * 24 * HOUR),
    revoked_at: null,
    ...over,
  };
}

async function rejects(verifier: PatVerifier, token: string) {
  const err: unknown = await verifier.verifyAccessToken(token).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OAuthError);
  expect((err as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
}

describe('PatVerifier (FEAT-07a)', () => {
  it('accepts an active token: AuthInfo with token id, scope, expiry and user', async () => {
    const pat = generatePat();
    const row = rowFor(pat);
    const { verifier, queries } = setup(row);
    const info = await verifier.verifyAccessToken(pat.token);
    expect(info.clientId).toBe(row.id);
    expect(info.scopes).toEqual(['mcp']);
    expect(info.expiresAt).toBe(Math.floor(row.expires_at.getTime() / 1000));
    expect(info.extra).toEqual({ userId: 'USR-1', prefix: pat.prefix });
    // looked up by prefix, last_used_at touched at most once a minute
    expect(queries[0]).toContain('"prefix" = $1');
    expect(queries[0]).toContain('"deletedAt" IS NULL');
    expect(queries[1]).toContain(`interval '1 minute'`);
  });

  it('a token without expiry gets now + 1 hour (re-verified every request)', async () => {
    const pat = generatePat();
    const { verifier } = setup(rowFor(pat, { expires_at: null }));
    const before = Math.floor(Date.now() / 1000);
    const info = await verifier.verifyAccessToken(pat.token);
    expect(info.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(info.expiresAt).toBeLessThanOrEqual(before + 3601);
  });

  it('rejects an expired token', async () => {
    const pat = generatePat();
    const { verifier } = setup(
      rowFor(pat, { expires_at: new Date(Date.now() - 1000) }),
    );
    await rejects(verifier, pat.token);
  });

  it('rejects a revoked token', async () => {
    const pat = generatePat();
    const { verifier } = setup(rowFor(pat, { revoked_at: new Date() }));
    await rejects(verifier, pat.token);
  });

  it('rejects a wrong secret for a known prefix', async () => {
    const pat = generatePat();
    const other = generatePat(pat.prefix);
    const { verifier } = setup(rowFor(pat));
    await rejects(verifier, other.token);
  });

  it('rejects an unknown prefix, or a deleted user (the join finds no row)', async () => {
    const pat = generatePat();
    const { verifier } = setup(null);
    await rejects(verifier, pat.token);
  });

  it('rejects anything that is not a PAT without touching the database', async () => {
    const { verifier, queries } = setup(null);
    await rejects(verifier, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln');
    await rejects(verifier, '');
    expect(queries).toEqual([]);
  });

  it('a failed last_used_at update does not block the request', async () => {
    const pat = generatePat();
    const row = rowFor(pat);
    const ds = {
      query: jest.fn((sql: string) =>
        sql.includes('SELECT')
          ? Promise.resolve([row])
          : Promise.reject(new Error('db down')),
      ),
    } as unknown as DataSource;
    const info = await new PatVerifier(new TokensService(ds)).verifyAccessToken(
      pat.token,
    );
    expect(info.clientId).toBe(row.id);
  });

  it('tokenStatus: revoked wins, then expired, else active', () => {
    const past = new Date(Date.now() - 1);
    const future = new Date(Date.now() + HOUR);
    expect(tokenStatus({ revoked_at: past, expires_at: past })).toBe('revoked');
    expect(tokenStatus({ revoked_at: null, expires_at: past })).toBe('expired');
    expect(tokenStatus({ revoked_at: null, expires_at: future })).toBe(
      'active',
    );
    expect(tokenStatus({ revoked_at: null, expires_at: null })).toBe('active');
  });
});
