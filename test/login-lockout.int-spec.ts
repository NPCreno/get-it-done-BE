/**
 * BUG-08: failed logins lock only that account. Real default limits and no
 * INTERNAL_API_SECRET, as production runs today (STATUS U2): every login is
 * unattested and comes from one socket.
 */
import './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';

const PASSWORD = 'passw0rd1';
const WRONG = 'wrong-pass1';
const LOCKED_MESSAGE =
  'Too many failed attempts for this account. Try again in 15 minutes.';

describe('per-account login lockout (BUG-08)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const byUsername = (username: string, password: string) =>
    request(server())
      .post('/api/user/loginUsername')
      .send({ username, password });
  const byEmail = (email: string, password: string) =>
    request(server()).post('/api/user/loginEmail').send({ email, password });

  beforeAll(async () => {
    delete process.env.INTERNAL_API_SECRET;
    app = await createTestApp({});
    for (const name of ['lock_a', 'lock_b', 'lock_c']) {
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
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it("5 wrong passwords lock account A, even with the right password; account B still signs in (the user's case)", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await byUsername('lock_a', WRONG);
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid credentials');
    }
    const sixth = await byUsername('lock_a', WRONG);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ statusCode: 429, message: LOCKED_MESSAGE });
    expect(sixth.headers['retry-after']).toMatch(/^\d+$/);
    const retry = Number(sixth.headers['retry-after']);
    expect(retry).toBeGreaterThan(14 * 60);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    // the message never echoes the identifier
    expect(JSON.stringify(sixth.body)).not.toContain('lock_a');

    const right = await byUsername('lock_a', PASSWORD);
    expect(right.status).toBe(429);
    expect(right.body.message).toBe(LOCKED_MESSAGE);

    const b = await byUsername('lock_b', PASSWORD);
    expect(b.status).toBe(201);
    expect(typeof b.body.data.access_token).toBe('string');
    const bWrong = await byUsername('lock_b', WRONG);
    expect(bWrong.status).toBe(401);
    expect(bWrong.body.message).toBe('Invalid credentials');
  });

  it('a success after 4 failures resets the count', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await byEmail('lock_c@example.com', WRONG)).status).toBe(401);
    }
    expect((await byEmail('LOCK_C@example.com', PASSWORD)).status).toBe(201);
    for (let i = 0; i < 4; i++) {
      expect((await byEmail('lock_c@example.com', WRONG)).status).toBe(401);
    }
    // 4 failures since the success: still open
    expect((await byEmail('lock_c@example.com', PASSWORD)).status).toBe(201);
  });

  it('an unknown account answers 401 like a wrong password, and 5 of them lock it', async () => {
    const unknownEmail = await byEmail('nobody-here@example.com', WRONG);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.message).toBe('Invalid credentials');
    const unknownUser = await byUsername('nobody_here', WRONG);
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.message).toBe('Invalid credentials');

    // capitalizations of one email share one lock (BUG-01)
    for (const email of [
      'Ghost@Example.com',
      'ghost@example.com ',
      'GHOST@EXAMPLE.COM',
      ' ghost@example.COM',
      'gHoSt@example.com',
    ]) {
      const r = await byEmail(email, WRONG);
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid credentials');
    }
    const locked = await byEmail('ghost@example.com', WRONG);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe(LOCKED_MESSAGE);
  });

  it('6 quick wrong logins spread over different accounts are never 429 (no per-socket limit)', async () => {
    for (let i = 0; i < 6; i++) {
      const r = await byUsername(`spread_${i}`, WRONG);
      expect(r.status).toBe(401);
    }
  });
});
