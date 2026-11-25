/**
 * FEAT-10a: the Pomodoro timer style preference, and the six-month name /
 * username / password rule reading identityChangedAt instead of updatedAt
 * (a preference save must never lock the name).
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);

describe('Pomodoro style + identityChangedAt (FEAT-10a)', () => {
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
        `SELECT "pomodoroStyle", "identityChangedAt", "updatedAt", fullname
           FROM users WHERE user_id = $1`,
        [u.user_id],
      )
    )[0] as {
      pomodoroStyle: string | null;
      identityChangedAt: Date;
      updatedAt: Date;
      fullname: string;
    };
  const ageIdentity = (u: TestUser, interval: string) =>
    q(
      `UPDATE users SET "identityChangedAt" = now() - $2::interval WHERE user_id = $1`,
      [u.user_id, interval],
    );

  it('PS1 PATCH pomodoroStyle ticket -> 200, GET returns it; no identityChangedAt in responses', async () => {
    const u = await signupAndLogin(app, 'pomo1');
    expect((await get(u)).body.pomodoroStyle).toBeNull();
    const res = await update(u, { pomodoroStyle: 'ticket' });
    expect(res.status).toBe(200);
    expect(res.body.pomodoroStyle).toBe('ticket');
    expect(res.body).not.toHaveProperty('identityChangedAt');
    expect(res.body).not.toHaveProperty('password');
    const got = await get(u);
    expect(got.status).toBe(200);
    expect(got.body.pomodoroStyle).toBe('ticket');
    expect(got.body).not.toHaveProperty('identityChangedAt');
    for (const style of ['horizon', 'dial']) {
      expect((await update(u, { pomodoroStyle: style })).status).toBe(200);
      expect((await row(u)).pomodoroStyle).toBe(style);
    }
  });

  it('PS2 unknown values -> 400 and the row keeps its style', async () => {
    const u = await signupAndLogin(app, 'pomo2');
    await update(u, { pomodoroStyle: 'horizon' });
    for (const bad of ['clock', 'Dial', '', null, 3]) {
      const res = await update(u, { pomodoroStyle: bad });
      expect(res.status).toBe(400);
    }
    expect((await row(u)).pomodoroStyle).toBe('horizon');
  });

  it('PS3 works right after a name change (the six-month rule does not block it)', async () => {
    const u = await signupAndLogin(app, 'pomo3');
    await ageIdentity(u, '1 year');
    expect((await update(u, { fullname: 'Renamed Pomo' })).status).toBe(200);
    const res = await update(u, { pomodoroStyle: 'ticket' });
    expect(res.status).toBe(200);
    expect(res.body.pomodoroStyle).toBe('ticket');
  });

  it("PS4 another user's id -> 401 from the self guard, row unchanged", async () => {
    const a = await signupAndLogin(app, 'pomo4a');
    const b = await signupAndLogin(app, 'pomo4b');
    const res = await update(a, { pomodoroStyle: 'ticket' }, b.user_id);
    expect(res.status).toBe(401);
    expect((await row(b)).pomodoroStyle).toBeNull();
  });

  it('ID1 preference saves leave identityChangedAt alone; a name change 7 months later is allowed', async () => {
    const u = await signupAndLogin(app, 'ident1');
    await ageIdentity(u, '7 months');
    const before = (await row(u)).identityChangedAt.getTime();
    for (const body of [
      { pomodoroStyle: 'ticket' },
      { theme: 'dark' },
      { soundFx: 'false' },
      { enableNotifications: 'true' },
    ]) {
      expect((await update(u, body)).status).toBe(200);
    }
    const after = await row(u);
    expect(after.identityChangedAt.getTime()).toBe(before);
    // updatedAt moved; the rule no longer reads it.
    expect(after.updatedAt.getTime()).toBeGreaterThan(before);
    const res = await update(u, { fullname: 'Seven Months' });
    expect(res.status).toBe(200);
    expect(res.body.fullname).toBe('Seven Months');
  });

  it('ID2 a name change sets identityChangedAt; a second one the same day -> 400', async () => {
    const u = await signupAndLogin(app, 'ident2');
    await ageIdentity(u, '1 year');
    const t0 = Date.now();
    expect((await update(u, { fullname: 'First Change' })).status).toBe(200);
    const stamped = (await row(u)).identityChangedAt.getTime();
    expect(Math.abs(stamped - t0)).toBeLessThan(60_000);
    const second = await update(u, { fullname: 'Second Change' });
    expect(second.status).toBe(400);
    expect(second.body.message).toContain('once every 6 months');
    expect((await row(u)).fullname).toBe('First Change');
  });

  it('ID3 username and password changes set identityChangedAt too', async () => {
    const u = await signupAndLogin(app, 'ident3');
    await ageIdentity(u, '1 year');
    expect((await update(u, { username: 'ident3_new' })).status).toBe(200);
    expect((await update(u, { password: 'another9' })).status).toBe(400);
    const v = await signupAndLogin(app, 'ident3b');
    await ageIdentity(v, '1 year');
    expect((await update(v, { password: 'another9' })).status).toBe(200);
    expect((await update(v, { fullname: 'Too Soon' })).status).toBe(400);
  });

  it('ID4 a new account gets now(): a name change right after signup is still 400', async () => {
    const u = await signupAndLogin(app, 'ident4');
    expect((await update(u, { fullname: 'Too Early' })).status).toBe(400);
  });

  it('ID5 signup and the user list never return identityChangedAt', async () => {
    const res = await request(server()).post('/api/user/create').send({
      fullname: 'Hidden Field',
      username: 'hidden_field',
      email: 'hidden@example.com',
      password: 'secret12',
    });
    expect(res.body.status).toBe('success');
    expect(res.body.data).not.toHaveProperty('identityChangedAt');
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data.pomodoroStyle ?? null).toBeNull();
  });
});
