import {
  checkDatabaseUrl,
  validateDatabaseEnv,
  validateEnv,
} from './env.validation';

const SECRET = 'S3CRET-SENTINEL-0123456789-0123456789';
const base = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgresql://postgres:dev@localhost:5433/getitdone',
  DATABASE_SYNCHRONIZE: 'true',
  JWT_SECRET: SECRET,
  JWT_REFRESH_SECRET: 'another-long-secret-0123456789-abcdef',
  JWT_ACCESS_EXPIRATION: '15m',
  JWT_REFRESH_EXPIRATION: '7d',
  JWT_REFRESH_EXPIRATION_SHORT: '1d',
  REFRESH_REUSE_GRACE_SECONDS: '30',
  INTERNAL_API_SECRET: 'internal',
  FRONTEND_URL: 'http://localhost:3000',
  PORT: '8000',
});
const prod = (): NodeJS.ProcessEnv => ({
  ...base(),
  NODE_ENV: 'production',
  DATABASE_SYNCHRONIZE: 'false',
  FRONTEND_URL: 'https://get-it-done.vercel.app',
});
const errorsFor = (over: Record<string, string | undefined>, from = base()) =>
  validateEnv({ ...from, ...over }).errors;

describe('validateEnv', () => {
  it('E1 .env.example-style values are valid', () => {
    const r = validateEnv(base());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each([
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_ACCESS_EXPIRATION',
  ])('E2 missing %s gives exactly one error naming it', (name) => {
    const env = base();
    delete env[name];
    expect(validateEnv(env).errors).toEqual([`${name}: required`]);
  });

  it('E2 done-when: starting without JWT_SECRET fails with a clear message', () => {
    const env = base();
    delete env.JWT_SECRET;
    expect(validateEnv(env).errors).toContain('JWT_SECRET: required');
  });

  it('E3 aggregates several problems', () => {
    const r = errorsFor({
      JWT_SECRET: undefined,
      DATABASE_URL: undefined,
      PORT: 'abc',
    });
    expect(r).toHaveLength(3);
  });

  it.each(['mysql://x/db', 'not a url', 'postgres:///db', 'postgres://'])(
    'E4 bad DATABASE_URL %s',
    (url) => {
      expect(errorsFor({ DATABASE_URL: url })).toHaveLength(1);
      expect(validateDatabaseEnv({ DATABASE_URL: url }).errors).toEqual(
        errorsFor({ DATABASE_URL: url }),
      );
    },
  );

  it('E4 validateDatabaseEnv: missing and valid', () => {
    expect(validateDatabaseEnv({}).errors).toEqual(['DATABASE_URL: required']);
    expect(checkDatabaseUrl('postgres://u:p@host:5432/db')).toBeNull();
    expect(validateDatabaseEnv(base()).errors).toEqual([]);
  });

  describe('E5 expiries (all three variables)', () => {
    const names = [
      'JWT_ACCESS_EXPIRATION',
      'JWT_REFRESH_EXPIRATION',
      'JWT_REFRESH_EXPIRATION_SHORT',
    ];
    it.each(['15m', '1h', '3600s', '7d', '1 day'])('%s is valid', (v) => {
      for (const n of names) expect(errorsFor({ [n]: v })).toEqual([]);
    });
    it.each(['3600', '900'])('numeric string %s needs a unit', (v) => {
      for (const n of names) {
        const e = errorsFor({ [n]: v });
        expect(e).toHaveLength(1);
        expect(e[0]).toContain(`${n}: must include a unit`);
      }
    });
    it.each(['abc', '15 minutes ago', ''])('malformed %p is rejected', (v) => {
      for (const n of names) expect(errorsFor({ [n]: v }).length).toBe(1);
    });
    it.each(['0s', '-5m', '500ms'])('zero or negative %s is rejected', (v) => {
      for (const n of names) expect(errorsFor({ [n]: v })).toHaveLength(1);
    });
    it('does not leak the probe secret', () => {
      expect(errorsFor({ JWT_ACCESS_EXPIRATION: 'abc' }).join()).not.toContain(
        'probe',
      );
    });
  });

  it('E6 REFRESH_REUSE_GRACE_SECONDS strict; unset -> 30', () => {
    for (const v of ['abc', '-1', '1.5', '3601', ''])
      expect(errorsFor({ REFRESH_REUSE_GRACE_SECONDS: v })).toHaveLength(1);
    for (const v of ['0', '30', '3600'])
      expect(errorsFor({ REFRESH_REUSE_GRACE_SECONDS: v })).toEqual([]);
    expect(
      validateEnv({ ...base(), REFRESH_REUSE_GRACE_SECONDS: undefined }).env
        .REFRESH_REUSE_GRACE_SECONDS,
    ).toBe(30);
  });

  it('E7 PORT strict; unset -> 8000', () => {
    for (const v of ['0', '65536', '80.5', 'abc', '-1'])
      expect(errorsFor({ PORT: v })).toHaveLength(1);
    expect(errorsFor({ PORT: '65535' })).toEqual([]);
    expect(validateEnv({ ...base(), PORT: undefined }).env.PORT).toBe(8000);
  });

  it('E8 DATABASE_SYNCHRONIZE strict; production + true is an error', () => {
    for (const v of ['TRUE', '1', 'yes', ''])
      expect(errorsFor({ DATABASE_SYNCHRONIZE: v })).toHaveLength(1);
    expect(errorsFor({ DATABASE_SYNCHRONIZE: 'false' })).toEqual([]);
    expect(errorsFor({ DATABASE_SYNCHRONIZE: undefined })).toEqual([]);
    expect(errorsFor({ DATABASE_SYNCHRONIZE: 'true' }, prod())).toEqual([
      'DATABASE_SYNCHRONIZE: must not be "true" when NODE_ENV=production',
    ]);
  });

  it('E9 FRONTEND_URL', () => {
    for (const v of [
      'not a url',
      'ftp://x',
      'https://',
      'https://app.example.com/path',
      'https://app.example.com/?a=1',
      'https://app.example.com/',
      'https://u:p@app.example.com',
    ])
      expect(errorsFor({ FRONTEND_URL: v })).toHaveLength(1);
    expect(errorsFor({ FRONTEND_URL: undefined }, prod())).toEqual([
      'FRONTEND_URL: required when NODE_ENV=production',
    ]);
    for (const v of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://[::1]:3000',
      'http://0.0.0.0:3000',
      'http://app.localhost',
    ])
      expect(errorsFor({ FRONTEND_URL: v }, prod())).toHaveLength(1);
    const opted = validateEnv({
      ...prod(),
      FRONTEND_URL: 'http://localhost:3000',
      FRONTEND_URL_ALLOW_LOCAL: 'true',
    });
    expect(opted.errors).toEqual([]);
    expect(opted.warnings.join()).toContain('FRONTEND_URL_ALLOW_LOCAL');
    expect(validateEnv(prod()).errors).toEqual([]);
  });

  it('E10 non-production without FRONTEND_URL is valid with the default', () => {
    const r = validateEnv({ ...base(), FRONTEND_URL: undefined });
    expect(r.errors).toEqual([]);
    expect(r.env.FRONTEND_URL).toBe('http://localhost:3000');
  });

  it('E11 missing INTERNAL_API_SECRET is a warning only', () => {
    const r = validateEnv({ ...base(), INTERNAL_API_SECRET: undefined });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain('INTERNAL_API_SECRET');
  });

  it('E12 production with short or equal secrets only warns', () => {
    const short = validateEnv({ ...prod(), JWT_SECRET: 'short-secret' });
    expect(short.errors).toEqual([]);
    expect(short.warnings.join()).toContain('JWT_SECRET: shorter than 32');
    const same = validateEnv({
      ...prod(),
      JWT_REFRESH_SECRET: prod().JWT_SECRET,
    });
    expect(same.errors).toEqual([]);
    expect(same.warnings.join()).toContain('identical');
    expect(validateEnv(base()).warnings).toEqual([]);
  });

  it('E13 no value ever appears in a message', () => {
    const r = validateEnv({
      ...base(),
      DATABASE_URL: 'mysql://user:P@SS-SENTINEL@host/db',
      FRONTEND_URL: 'https://u:P@SS-SENTINEL@x.com/path',
      PORT: 'abc',
      JWT_ACCESS_EXPIRATION: 'abc',
      NODE_ENV: 'bogus',
    });
    expect(r.errors.length).toBeGreaterThan(3);
    const all = [...r.errors, ...r.warnings].join('\n');
    expect(all).not.toContain('S3CRET-SENTINEL');
    expect(all).not.toContain('P@SS-SENTINEL');
    expect(all).not.toContain('bogus');
  });

  it('E14 NODE_ENV', () => {
    expect(validateEnv(base()).env.NODE_ENV).toBe('development');
    expect(errorsFor({ NODE_ENV: 'test' })).toEqual([]);
    expect(errorsFor({ NODE_ENV: 'staging' })).toEqual([
      'NODE_ENV: must be one of development, test, production',
    ]);
    expect(errorsFor({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toEqual([
      'NODE_ENV: must be set explicitly on Railway (expected "production")',
    ]);
    expect(errorsFor({ RAILWAY_PROJECT_ID: 'abc' })).toHaveLength(1);
    expect(
      errorsFor({ RAILWAY_ENVIRONMENT_NAME: 'production' }, { ...prod() }),
    ).toEqual([]);
  });

  it('E15 the AppEnv view mirrors the runtime defaults', () => {
    const only: NodeJS.ProcessEnv = {
      DATABASE_URL: base().DATABASE_URL,
      JWT_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
      JWT_ACCESS_EXPIRATION: '15m',
    };
    const { env, errors } = validateEnv(only);
    expect(errors).toEqual([]);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 8000,
      DATABASE_SYNCHRONIZE: false,
      FRONTEND_URL: 'http://localhost:3000',
      JWT_REFRESH_EXPIRATION: '7d',
      JWT_REFRESH_EXPIRATION_SHORT: '1d',
      REFRESH_REUSE_GRACE_SECONDS: 30,
    });
  });
});
