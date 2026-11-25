/** BUG-01: login by email ignores case and surrounding spaces; the account lock (BUG-08) does too. */
import './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';

const SECRET = 'login-email-case-secret';
const password = 'passw0rd1';

describe('login by email ignores case (BUG-01)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const loginEmail = (email: string, pw = password, ip = '198.51.100.1') =>
    request(server())
      .post('/api/user/loginEmail')
      .set({ 'X-Internal-Secret': SECRET, 'X-Client-IP': ip })
      .send({ email, password: pw });

  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    app = await createTestApp();
    const created = await request(server()).post('/api/user/create').send({
      fullname: 'Case Test',
      username: 'case_user',
      email: ' Case@Test.Dev ',
      password,
    });
    expect(created.status).toBe(201);
    // stored trimmed and lower-cased
    expect(created.body.data.email).toBe('case@test.dev');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    delete process.env.INTERNAL_API_SECRET;
  });

  it.each([
    'case@test.dev',
    'Case@Test.Dev',
    'CASE@TEST.DEV ',
    ' cAsE@tEsT.dEv',
  ])('signs in as %j', async (email) => {
    const res = await loginEmail(email);
    expect(res.status).toBe(201);
    expect(typeof res.body.data.access_token).toBe('string');
  });

  it('an email-like username is looked up the same way', async () => {
    const res = await request(server())
      .post('/api/user/loginUsername')
      .send({ username: 'CASE@test.dev', password });
    expect(res.status).toBe(201);
  });

  it('a wrong password still fails', async () => {
    const res = await loginEmail('CASE@TEST.DEV', 'wrong-pass1');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('a signup that differs only in case or spaces is a duplicate', async () => {
    const res = await request(server()).post('/api/user/create').send({
      fullname: 'Case Again',
      username: 'case_user2',
      email: 'CASE@TEST.DEV',
      password,
    });
    // BUG-07: a real 409, one message for email and username alike.
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('That email or username is already taken.');
  });

  it('usernames stay case-sensitive', async () => {
    const res = await request(server())
      .post('/api/user/loginUsername')
      .send({ username: 'CASE_USER', password });
    expect(res.status).toBe(401);
  });
});

describe('the account lock folds email case (BUG-01, BUG-08)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    // Real defaults. Every try comes from a different attested IP, so only
    // the per-account lock counts.
    app = await createTestApp({});
  }, 60000);
  afterAll(async () => {
    await app?.close();
    delete process.env.INTERNAL_API_SECRET;
  });

  it('five wrong tries across mixed capitals lock one account', async () => {
    const spellings = [
      'victim@example.com',
      'Victim@Example.com',
      'VICTIM@EXAMPLE.COM ',
      ' victim@EXAMPLE.com',
      'vIcTiM@example.COM',
    ];
    for (const [i, email] of spellings.entries()) {
      const r = await request(app.getHttpServer())
        .post('/api/user/loginEmail')
        .set({
          'X-Internal-Secret': SECRET,
          'X-Client-IP': `198.51.100.${10 + i}`,
        })
        .send({ email, password: 'wrong-pass1' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/user/loginEmail')
      .set({ 'X-Internal-Secret': SECRET, 'X-Client-IP': '198.51.100.99' })
      .send({ email: 'Victim@example.COM', password: 'wrong-pass1' });
    expect(blocked.status).toBe(429);
    // a different email is a different account
    const other = await request(app.getHttpServer())
      .post('/api/user/loginEmail')
      .set({ 'X-Internal-Secret': SECRET, 'X-Client-IP': '198.51.100.98' })
      .send({ email: 'someone@example.com', password: 'wrong-pass1' });
    expect(other.status).toBe(401);
  });
});
