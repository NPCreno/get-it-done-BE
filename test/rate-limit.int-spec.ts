/** SEC-09: auth rate limiting (real default limits) and helmet headers. */
import './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';

const SECRET = 'rate-limit-test-secret';
const server = (app: INestApplication) => app.getHttpServer();

function post(
  app: INestApplication,
  path: string,
  body: object,
  headers: Record<string, string> = {},
) {
  return request(server(app)).post(path).set(headers).send(body);
}
const attested = (ip: string) => ({
  'X-Internal-Secret': SECRET,
  'X-Client-IP': ip,
});
const login = (
  app: INestApplication,
  ip: string,
  n: number,
  kind: 'email' | 'username' = 'username',
) =>
  kind === 'email'
    ? post(
        app,
        '/api/user/loginEmail',
        { email: `nobody${n}@example.com`, password: 'wrong-pass1' },
        attested(ip),
      )
    : post(
        app,
        '/api/user/loginUsername',
        { username: `nobody${n}`, password: 'wrong-pass1' },
        attested(ip),
      );

describe('rate limiting and helmet (SEC-09)', () => {
  let app: INestApplication;
  beforeAll(() => {
    process.env.INTERNAL_API_SECRET = SECRET;
  });
  afterAll(() => {
    delete process.env.INTERNAL_API_SECRET;
  });
  // every test gets fresh in-memory counters
  beforeEach(async () => {
    app = await createTestApp({});
  }, 60000);
  afterEach(async () => {
    await app?.close();
  });

  it('T1: login buckets are shared by loginEmail and loginUsername', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await login(
        app,
        '198.51.100.10',
        i,
        i % 2 ? 'email' : 'username',
      );
      expect(r.status).not.toBe(429);
    }
    const r = await login(app, '198.51.100.10', 99, 'email');
    expect(r.status).toBe(429);
  });

  it('T2: a different attested IP is unaffected', async () => {
    for (let i = 0; i < 11; i++) await login(app, '198.51.100.20', i);
    const other = await login(app, '198.51.100.21', 1);
    expect(other.status).not.toBe(429);
  });

  it('T3: the identifier is limited across IPs; no identifier never trips it', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await post(
        app,
        '/api/user/loginUsername',
        { username: 'victim', password: 'wrong-pass1' },
        attested(`198.51.100.${30 + i}`),
      );
      expect(r.status).not.toBe(429);
    }
    const blocked = await post(
      app,
      '/api/user/loginUsername',
      { username: 'victim', password: 'wrong-pass1' },
      attested('198.51.100.99'),
    );
    expect(blocked.status).toBe(429);
    const none = await post(
      app,
      '/api/user/loginUsername',
      { password: 'wrong-pass1' },
      attested('198.51.100.100'),
    );
    expect(none.status).toBe(400);
  });

  it('T4: attested IPv6 addresses in one /64 share a bucket', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await login(app, `2001:db8:aaaa:1::${i + 1}`, i);
      expect(r.status).not.toBe(429);
    }
    expect((await login(app, '2001:db8:aaaa:1:ffff::9', 50)).status).toBe(429);
    expect((await login(app, '2001:db8:aaaa:2::1', 51)).status).not.toBe(429);
  });

  it('T5: spoofed headers without the secret hit the global unattested cap', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await post(
        app,
        '/api/user/loginUsername',
        { username: `spoof${i}`, password: 'wrong-pass1' },
        { 'X-Client-IP': `9.9.9.${i}`, 'X-Real-IP': `8.8.8.${i}` },
      );
      expect(r.status).not.toBe(429);
    }
    const capped = await post(
      app,
      '/api/user/loginUsername',
      { username: 'spoof31', password: 'wrong-pass1' },
      { 'X-Client-IP': '9.9.9.200', 'X-Real-IP': '8.8.8.200' },
    );
    expect(capped.status).toBe(429);
    // attested traffic is not affected by that cap
    expect((await login(app, '198.51.100.77', 1)).status).not.toBe(429);
  });

  it('T6: signup, refresh and logout have independent buckets', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post(
        app,
        '/api/user/create',
        {
          fullname: `Person ${i}`,
          username: `person${i}`,
          email: `person${i}@example.com`,
          password: 'passw0rd1',
        },
        attested('198.51.100.40'),
      );
      expect(r.status).not.toBe(429);
    }
    const sixth = await post(
      app,
      '/api/user/create',
      {
        fullname: 'Person 6',
        username: 'person6',
        email: 'person6@example.com',
        password: 'passw0rd1',
      },
      attested('198.51.100.40'),
    );
    expect(sixth.status).toBe(429);

    for (let i = 0; i < 60; i++) {
      const r = await post(
        app,
        '/api/auth/refresh',
        { refreshToken: 'junk' },
        attested('198.51.100.41'),
      );
      expect(r.status).not.toBe(429);
    }
    expect(
      (
        await post(
          app,
          '/api/auth/refresh',
          { refreshToken: 'junk' },
          attested('198.51.100.41'),
        )
      ).status,
    ).toBe(429);
    const out = await post(
      app,
      '/api/auth/logout',
      { refreshToken: 'junk' },
      attested('198.51.100.41'),
    );
    expect(out.status).not.toBe(429);
  });

  it('T7: a 429 has a numeric Retry-After and no per-throttler headers', async () => {
    for (let i = 0; i < 10; i++) await login(app, '198.51.100.50', i);
    const r = await login(app, '198.51.100.50', 77);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(3600);
    expect(
      Object.keys(r.headers).filter((h) =>
        /^(retry-after-|x-ratelimit)/.test(h),
      ),
    ).toEqual([]);
    expect(r.body.message).toBe(
      'Too many attempts. Please wait and try again.',
    );
  });

  it('T8: helmet headers on 200, 401, 429 and the CORS preflight', async () => {
    const ok = await request(server(app)).get('/');
    const unauth = await request(server(app)).get('/api/user/getAll');
    for (let i = 0; i < 10; i++) await login(app, '198.51.100.60', i);
    const limited = await login(app, '198.51.100.60', 88);
    expect(unauth.status).toBe(401);
    expect(limited.status).toBe(429);
    for (const r of [ok, unauth, limited]) {
      expect(r.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['strict-transport-security']).toBe('max-age=15552000');
      expect(r.headers['x-powered-by']).toBeUndefined();
    }
    const pre = await request(server(app))
      .options('/api/user/loginUsername')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(pre.headers['access-control-allow-credentials']).toBe('true');
    expect(pre.headers['x-content-type-options']).toBe('nosniff');
  });

  it('T11: routes without @RateLimit never return 429', async () => {
    for (let i = 0; i < 500; i++) {
      const r = await request(server(app)).get('/api/user/getAll');
      if (r.status === 429) throw new Error(`429 at request ${i}`);
    }
  }, 60000);
});

describe('limits override (SEC-09 T10)', () => {
  it('the default test app has high limits; real defaults 429 at 11', async () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    const high = await createTestApp();
    try {
      for (let i = 0; i < 50; i++) {
        const r = await login(high, '198.51.100.70', i);
        expect(r.status).not.toBe(429);
      }
    } finally {
      await high.close();
    }
    const real = await createTestApp({});
    try {
      let last = 0;
      for (let i = 0; i < 11; i++)
        last = (await login(real, '198.51.100.70', i)).status;
      expect(last).toBe(429);
    } finally {
      await real.close();
      delete process.env.INTERNAL_API_SECRET;
    }
  }, 120000);
});
