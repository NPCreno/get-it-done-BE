/**
 * FEAT-07a: /api/tokens (personal access tokens, managed with the website's
 * JWT). The secret leaves the server once; the database keeps only a hash.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import { chatTestLimits } from './chat-fixtures';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);
const DAY = 24 * 3600_000;
const TOKEN_KEYS = [
  'created_at',
  'expires_at',
  'id',
  'last_used_at',
  'name',
  'prefix',
  'revoked_at',
  'status',
];

describe('/api/tokens (FEAT-07a)', () => {
  let app: INestApplication;
  let A: TestUser;
  let B: TestUser;
  const server = () => app.getHttpServer();
  const create = (u: TestUser, body: Record<string, unknown>) =>
    request(server()).post('/api/tokens').set(bearer(u)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    A = await signupAndLogin(app, 'toka');
    B = await signupAndLogin(app, 'tokb');
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('needs the website JWT', async () => {
    await request(server()).get('/api/tokens').expect(401);
    await request(server()).post('/api/tokens').send({ name: 'x' }).expect(401);
  });

  it('create: the secret appears once, default expiry 90 days, no-store', async () => {
    const res = await create(A, { name: '  Claude Code  ' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const d = res.body.data;
    expect(Object.keys(d).sort()).toEqual([...TOKEN_KEYS, 'token'].sort());
    expect(d.name).toBe('Claude Code');
    expect(d.status).toBe('active');
    expect(d.token).toMatch(/^gid_pat_[0-9A-Za-z]{10}_[A-Za-z0-9_-]{43}$/);
    expect(d.token.slice(8, 18)).toBe(d.prefix);
    const expires = new Date(d.expires_at).getTime();
    expect(Math.abs(expires - (Date.now() + 90 * DAY))).toBeLessThan(60_000);
    // stored: prefix + sha256 of the secret, never the token
    const [row] = await q(
      'SELECT * FROM personal_access_tokens WHERE id = $1',
      [d.id],
    );
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(d.token.slice(19));
    expect(row.scopes).toBe('mcp');
  });

  it('list: no secret or hash, newest first, no-store', async () => {
    const res = await request(server()).get('/api/tokens').set(bearer(A));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    for (const t of res.body.data)
      expect(Object.keys(t).sort()).toEqual(TOKEN_KEYS);
    expect(JSON.stringify(res.body)).not.toMatch(/gid_pat_|secret_hash/);
    const other = await request(server()).get('/api/tokens').set(bearer(B));
    expect(other.body.data).toEqual([]);
  });

  it('expiry choices: 30, 365, null; anything else is 400', async () => {
    const thirty = (await create(A, { name: 'a', expires_in_days: 30 })).body
      .data;
    expect(
      Math.abs(new Date(thirty.expires_at).getTime() - (Date.now() + 30 * DAY)),
    ).toBeLessThan(60_000);
    const never = (await create(A, { name: 'b', expires_in_days: null })).body
      .data;
    expect(never.expires_at).toBeNull();
    await create(A, { name: 'c', expires_in_days: 7 }).expect(400);
    await create(A, { name: 'c', expires_in_days: '30' }).expect(400);
    await create(A, { name: '   ' }).expect(400);
    await create(A, { name: 'x'.repeat(61) }).expect(400);
    await create(A, {}).expect(400);
  });

  it('revoke: idempotent; another user or an unknown id is 404', async () => {
    const t = (await create(A, { name: 'revoke me' })).body.data;
    await request(server())
      .delete(`/api/tokens/${t.id}`)
      .set(bearer(B))
      .expect(404);
    const first = await request(server())
      .delete(`/api/tokens/${t.id}`)
      .set(bearer(A));
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data.status).toBe('revoked');
    const again = await request(server())
      .delete(`/api/tokens/${t.id}`)
      .set(bearer(A));
    expect(again.body.data.revoked_at).toBe(first.body.data.revoked_at);
    await request(server())
      .delete('/api/tokens/00000000-0000-4000-8000-000000000000')
      .set(bearer(A))
      .expect(404);
    await request(server())
      .delete('/api/tokens/not-a-uuid')
      .set(bearer(A))
      .expect(404);
  });

  it('at most 10 active tokens; revoked and expired ones do not count', async () => {
    const C = await signupAndLogin(app, 'tokc');
    const ids: string[] = [];
    for (let i = 0; i < 10; i++)
      ids.push((await create(C, { name: `t${i}` })).body.data.id);
    const over = await create(C, { name: 'eleven' });
    expect(over.status).toBe(400);
    expect(over.body.message).toBe('You can have at most 10 active tokens.');
    await request(server())
      .delete(`/api/tokens/${ids[0]}`)
      .set(bearer(C))
      .expect(200);
    await create(C, { name: 'after revoke' }).expect(201);
    await q(
      `UPDATE personal_access_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [ids[1]],
    );
    const list = (await request(server()).get('/api/tokens').set(bearer(C)))
      .body.data;
    expect(list.find((t: { id: string }) => t.id === ids[1]).status).toBe(
      'expired',
    );
    await create(C, { name: 'after expiry' }).expect(201);
    await create(C, { name: 'twelve' }).expect(400);
  });

  it('tokens cascade with their user', async () => {
    const D = await signupAndLogin(app, 'tokd');
    await create(D, { name: 'x' }).expect(201);
    await q('DELETE FROM users WHERE user_id = $1', [D.user_id]);
    const [{ n }] = await q(
      'SELECT count(*)::int AS n FROM personal_access_tokens WHERE user_id = $1',
      [D.user_id],
    );
    expect(n).toBe(0);
  });
});

describe('/api/tokens rate limit (FEAT-07a)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const limits = await chatTestLimits();
    delete limits['token-create-user-1h'];
    app = await createTestApp(limits);
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('create: 10 per hour per user, then 429 with Retry-After', async () => {
    const A = await signupAndLogin(app, 'tokrl');
    for (let i = 0; i < 10; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/tokens')
        .set(bearer(A))
        .send({ name: `n${i}`, expires_in_days: null });
      // the 10-token cap and the hourly limit coincide; revoke to keep creating
      expect(r.status).toBe(201);
      await request(app.getHttpServer())
        .delete(`/api/tokens/${r.body.data.id}`)
        .set(bearer(A));
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/tokens')
      .set(bearer(A))
      .send({ name: 'eleventh' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
