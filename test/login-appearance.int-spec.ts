/**
 * RD-3a: both login responses carry data.appearance ({theme, appTheme}) from
 * the user's row, nulls when unset, so the FE login route can set its display
 * cookie. The token fields are unchanged, nothing else about the user is
 * added, and the refresh response stays a bare token pair.
 */
import './int-env';
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);
const PASSWORD = 'passw0rd1';
const TOKEN_KEYS = [
  'access_expires_in',
  'access_token',
  'expires_in',
  'refresh_expires_in',
  'refresh_token',
];

/** The payload of a JWT, without checking the signature (test only). */
function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('login responses carry the appearance (RD-3a)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const byEmail = (email: string) =>
    request(server())
      .post('/api/user/loginEmail')
      .send({ email, password: PASSWORD });
  const byUsername = (username: string) =>
    request(server())
      .post('/api/user/loginUsername')
      .send({ username, password: PASSWORD });

  beforeAll(async () => {
    app = await createTestApp();
    for (const name of ['look_set', 'look_null', 'look_mode']) {
      const r = await request(server())
        .post('/api/user/create')
        .send({
          fullname: name,
          username: name,
          email: `${name}@example.com`,
          password: PASSWORD,
        });
      expect(r.status).toBe(201);
    }
    await q(
      `UPDATE users SET theme = 'dark', "appTheme" = 'calm' WHERE username = 'look_set'`,
    );
    await q(
      `UPDATE users SET theme = NULL, "appTheme" = NULL WHERE username = 'look_null'`,
    );
    await q(
      `UPDATE users SET theme = 'system', "appTheme" = NULL WHERE username = 'look_mode'`,
    );
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('A1: a login by email returns the stored theme and appTheme', async () => {
    const res = await byEmail('look_set@example.com');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.appearance).toEqual({
      theme: 'dark',
      appTheme: 'calm',
    });
  });

  it('A2: a login by username returns the same', async () => {
    const res = await byUsername('look_set');
    expect(res.status).toBe(201);
    expect(res.body.data.appearance).toEqual({
      theme: 'dark',
      appTheme: 'calm',
    });
  });

  it('A3: a user with no preferences gets both as null (key present), by email and by username', async () => {
    for (const res of [
      await byEmail('look_null@example.com'),
      await byUsername('look_null'),
    ]) {
      expect(res.status).toBe(201);
      expect(res.body.data.appearance).toStrictEqual({
        theme: null,
        appTheme: null,
      });
    }
  });

  it('A4: one set, one unset', async () => {
    const res = await byUsername('look_mode');
    expect(res.body.data.appearance).toStrictEqual({
      theme: 'system',
      appTheme: null,
    });
  });

  it('A5: the token fields are unchanged and nothing else about the user is added', async () => {
    const res = await byEmail('look_set@example.com');
    expect(Object.keys(res.body).sort()).toEqual([
      'data',
      'error',
      'message',
      'status',
    ]);
    expect(res.body.message).toBe('Login successful');
    expect(res.body.error).toBeNull();
    expect(Object.keys(res.body.data).sort()).toEqual(
      [...TOKEN_KEYS, 'appearance'].sort(),
    );
    expect(Object.keys(res.body.data.appearance).sort()).toEqual([
      'appTheme',
      'theme',
    ]);
    const d = res.body.data;
    expect(typeof d.access_token).toBe('string');
    expect(typeof d.refresh_token).toBe('string');
    expect(d.expires_in).toBe(3600);
    expect(Number.isInteger(d.access_expires_in)).toBe(true);
    expect(d.access_expires_in).toBeGreaterThan(0);
    expect(Number.isInteger(d.refresh_expires_in)).toBe(true);
    expect(d.refresh_expires_in).toBeGreaterThan(0);
    // no email, role or id leaks into the body beyond the tokens
    const body = JSON.stringify({ ...d, access_token: '', refresh_token: '' });
    expect(body).not.toContain('look_set');
    expect(body).not.toContain('standard');
    // the access token works and still has no appTheme claim
    expect(jwtPayload(d.access_token)).not.toHaveProperty('appTheme');
    const me = await request(server())
      .get(`/api/user/get/${String(jwtPayload(d.access_token).sub)}`)
      .set('Authorization', `Bearer ${d.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.appTheme).toBe('calm');
  });

  it('A6: the refresh response is the bare token pair (no appearance)', async () => {
    const login = await byUsername('look_set');
    const refreshed = await request(server())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.data.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(Object.keys(refreshed.body.data).sort()).toEqual(TOKEN_KEYS);
  });

  it('A7: a wrong password is still the plain 401 (no appearance)', async () => {
    const res = await request(server())
      .post('/api/user/loginUsername')
      .send({ username: 'look_set', password: 'wrong-pass1' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
    expect(JSON.stringify(res.body)).not.toContain('appearance');
  });
});
