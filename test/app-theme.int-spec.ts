/**
 * RD-1a: appearance preferences. users.theme is the mode (light, dark,
 * system); users."appTheme" is the theme family (classic, calm, field; null =
 * classic). Both are preferences, so saving them never touches
 * identityChangedAt (the six-month name rule, FEAT-10a).
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);

describe('Appearance preferences: theme mode + appTheme (RD-1a)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  const update = (u: TestUser, body: Record<string, unknown>, id = u.user_id) =>
    request(server()).patch(`/api/user/update/${id}`).set(bearer(u)).send(body);
  const get = (u: TestUser) =>
    request(server()).get(`/api/user/get/${u.user_id}`).set(bearer(u));
  const row = async (u: TestUser) =>
    (
      await q(
        `SELECT theme, "appTheme", "identityChangedAt" FROM users WHERE user_id = $1`,
        [u.user_id],
      )
    )[0] as {
      theme: string | null;
      appTheme: string | null;
      identityChangedAt: Date;
    };

  it('AT1 PATCH { appTheme: field, theme: system } -> 200; GET returns both', async () => {
    const u = await signupAndLogin(app, 'appear1');
    const res = await update(u, { appTheme: 'field', theme: 'system' });
    expect(res.status).toBe(200);
    expect(res.body.appTheme).toBe('field');
    expect(res.body.theme).toBe('system');
    expect(res.body).not.toHaveProperty('identityChangedAt');
    expect(res.body).not.toHaveProperty('password');
    const got = await get(u);
    expect(got.status).toBe(200);
    expect(got.body.appTheme).toBe('field');
    expect(got.body.theme).toBe('system');
    for (const t of ['calm', 'classic']) {
      expect((await update(u, { appTheme: t })).status).toBe(200);
      expect((await row(u)).appTheme).toBe(t);
    }
    // appTheme alone leaves the mode alone, and the other way round.
    expect((await row(u)).theme).toBe('system');
    expect((await update(u, { theme: 'dark' })).status).toBe(200);
    expect(await row(u)).toMatchObject({ theme: 'dark', appTheme: 'classic' });
  });

  it('AT2 unknown values -> 400 and the row keeps its values', async () => {
    const u = await signupAndLogin(app, 'appear2');
    await update(u, { appTheme: 'calm', theme: 'light' });
    for (const body of [
      { appTheme: 'ink' },
      { appTheme: 'Calm' },
      { appTheme: '' },
      { appTheme: 3 },
      { theme: 'System' },
      { theme: 'auto' },
      { appTheme: 'field', theme: 'neon' },
    ]) {
      const res = await update(u, body);
      expect(res.status).toBe(400);
    }
    expect(await row(u)).toMatchObject({ theme: 'light', appTheme: 'calm' });
  });

  it("AT3 another user's id -> 401 from the self guard, row unchanged", async () => {
    const a = await signupAndLogin(app, 'appear3a');
    const b = await signupAndLogin(app, 'appear3b');
    const res = await update(
      a,
      { appTheme: 'field', theme: 'system' },
      b.user_id,
    );
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Access denied: Not your data.');
    expect(await row(b)).toMatchObject({ theme: null, appTheme: null });
  });

  it('AT4 identityChangedAt is unchanged after appearance saves; a name change still works', async () => {
    const u = await signupAndLogin(app, 'appear4');
    await q(
      `UPDATE users SET "identityChangedAt" = now() - interval '7 months' WHERE user_id = $1`,
      [u.user_id],
    );
    const before = (await row(u)).identityChangedAt.getTime();
    for (const body of [
      { appTheme: 'calm' },
      { theme: 'system' },
      { appTheme: 'field', theme: 'dark' },
    ]) {
      expect((await update(u, body)).status).toBe(200);
    }
    expect((await row(u)).identityChangedAt.getTime()).toBe(before);
    const res = await update(u, { fullname: 'Still Allowed' });
    expect(res.status).toBe(200);
    expect(res.body.fullname).toBe('Still Allowed');
  });

  it('AT5 a user without appTheme gets appTheme: null (= classic)', async () => {
    const u = await signupAndLogin(app, 'appear5');
    expect((await row(u)).appTheme).toBeNull();
    const got = await get(u);
    expect(got.status).toBe(200);
    expect(got.body).toHaveProperty('appTheme', null);
    // The update response carries the key too, even when only the mode moved.
    const res = await update(u, { theme: 'dark' });
    expect(res.body).toHaveProperty('appTheme', null);
  });

  it('AT7 an explicit null resets appTheme to classic (null); theme is untouched', async () => {
    const u = await signupAndLogin(app, 'appear7');
    await update(u, { appTheme: 'calm', theme: 'dark' });
    const res = await update(u, { appTheme: null });
    expect(res.status).toBe(200);
    expect(res.body.appTheme).toBeNull();
    expect(await row(u)).toMatchObject({ theme: 'dark', appTheme: null });
  });

  it('AT6 signup leaves appTheme null', async () => {
    const res = await request(server()).post('/api/user/create').send({
      fullname: 'Fresh Appearance',
      username: 'fresh_appearance',
      email: 'fresh_appearance@example.com',
      password: 'secret12',
    });
    expect(res.body.status).toBe('success');
    expect(res.body.data.appTheme ?? null).toBeNull();
  });
});
