/**
 * Integration tests against a real Postgres (the REF-19 Docker container).
 * Run with `pnpm db:up && pnpm test:int`. Uses database `getitdone_test`
 * (created on demand) with `synchronize: true` for this DataSource only.
 */
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRATION = '15m';
process.env.REFRESH_REUSE_GRACE_SECONDS = '30';
delete process.env.JWT_REFRESH_EXPIRATION;
delete process.env.JWT_REFRESH_EXPIRATION_SHORT;

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthorizeGuard } from './guards/authorize.guard';
import { AuthTokenEntity } from './models/auth.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { User } from 'src/user/models/user.interface';

const bcrypt = require('bcrypt');

const BASE_URL =
  process.env.TEST_DATABASE_URL_BASE ??
  'postgresql://postgres:dev@localhost:5433';
const TEST_DB = 'getitdone_test';

async function ensureTestDb(): Promise<void> {
  const c = new Client({ connectionString: `${BASE_URL}/postgres` });
  await c.connect();
  const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    TEST_DB,
  ]);
  if (r.rowCount === 0) await c.query(`CREATE DATABASE ${TEST_DB}`);
  await c.end();
}

describe('AuthService refresh rotation (integration)', () => {
  let auth: AuthService;
  let jwt: JwtService;
  let ds: DataSource;
  let tokens: ReturnType<DataSource['getRepository']>;
  let user: UserEntity;
  let tokenUser: User;

  beforeAll(async () => {
    await ensureTestDb();
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: `${BASE_URL}/${TEST_DB}`,
          entities: [__dirname + '/../**/*.entity.ts'],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([AuthTokenEntity, UserEntity]),
      ],
      providers: [AuthService],
    }).compile();
    auth = mod.get(AuthService);
    jwt = mod.get(JwtService);
    ds = mod.get(DataSource);
    tokens = ds.getRepository(AuthTokenEntity);
    user = await ds.getRepository(UserEntity).save(
      ds.getRepository(UserEntity).create({
        fullname: 'Test User',
        user_id: 'u-test-1',
        username: 'tester',
        email: 'tester@example.com',
        password: 'x',
        tier: 'free',
      }),
    );
    tokenUser = {
      ...user,
      firstname: 'Test',
      lastname: 'User',
    } as unknown as User;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function login(rememberMe: boolean) {
    const access = auth.generateAccessToken(tokenUser);
    const refresh = await auth.generateRefreshToken(tokenUser, {
      ip: null,
      rememberMe,
    });
    return { access, refresh, pair: auth.buildPair(access, refresh) };
  }

  const familyRows = async (token: string) => {
    const jti = (jwt.decode(token) as { jti: string }).jti;
    const row = (await tokens.findOneByOrFail({
      token_id: jti,
    } as never)) as AuthTokenEntity;
    return tokens.find({
      where: { family_id: row.family_id } as never,
    }) as Promise<AuthTokenEntity[]>;
  };

  it('5 parallel refreshes return the identical pair and create exactly 1 new row', async () => {
    const { refresh } = await login(true);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => auth.refresh(refresh.token, null)),
    );
    const uniq = new Set(results.map((r) => r.refresh_token));
    expect(uniq.size).toBe(1);
    expect(await familyRows(refresh.token)).toHaveLength(2);
  });

  it('refresh after the grace window is reuse: family revoked', async () => {
    const { refresh } = await login(true);
    const next = await auth.refresh(refresh.token, null);
    const jti = (jwt.decode(refresh.token) as { jti: string }).jti;
    await tokens.update(
      { token_id: jti } as never,
      { revoked_at: new Date(Date.now() - 3600_000) } as never,
    );
    await expect(auth.refresh(refresh.token, null)).rejects.toMatchObject({
      response: { code: 'REFRESH_REUSED' },
    });
    const rows = await familyRows(next.refresh_token);
    expect(rows.every((r) => r.is_revoked)).toBe(true);
  });

  it('chain replay: X->Y, Y->Z, late X within grace returns Z', async () => {
    const { refresh: x } = await login(true);
    const y = await auth.refresh(x.token, null);
    const z = await auth.refresh(y.refresh_token, null);
    const late = await auth.refresh(x.token, null);
    expect(late.refresh_token).toBe(z.refresh_token);
  });

  it('logout revokes the family; refresh afterwards is REFRESH_INVALID', async () => {
    const { refresh } = await login(true);
    const next = await auth.refresh(refresh.token, null);
    await auth.logout(next.refresh_token);
    await expect(auth.refresh(next.refresh_token, null)).rejects.toMatchObject({
      response: { code: 'REFRESH_INVALID' },
    });
    expect(
      (await familyRows(next.refresh_token)).every((r) => r.is_revoked),
    ).toBe(true);
  });

  it('remember_me=false stays ~1d across a refresh', async () => {
    const { refresh } = await login(false);
    const next = await auth.refresh(refresh.token, null);
    expect(next.refresh_expires_in).toBeGreaterThan(86400 - 5);
    expect(next.refresh_expires_in).toBeLessThanOrEqual(86400);
  });

  it('remember_me=true is ~7d', async () => {
    const { pair } = await login(true);
    expect(pair.refresh_expires_in).toBe(7 * 86400);
    expect(pair.access_expires_in).toBe(900);
  });

  it('a legacy bcrypt row still refreshes once', async () => {
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { sub: user.user_id, jti, type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
    );
    await tokens.save(
      tokens.create({
        token_id: jti,
        user_id: user.user_id,
        token: await bcrypt.hash(token, 4),
        expires_at: new Date(Date.now() + 7 * 86400_000),
        is_revoked: false,
        family_id: crypto.randomUUID(),
        remember_me: true,
        ip_address: null,
      }),
    );
    const first = await auth.refresh(token, null);
    expect(first.refresh_token).toBeTruthy();
  });

  it('guard rejects a refresh token used as Bearer', async () => {
    const { refresh, access } = await login(true);
    const guard = new AuthorizeGuard(jwt);
    const ctx = (bearer: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: `Bearer ${bearer}` },
          }),
        }),
      }) as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx(refresh.token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(ctx(refresh.token))).rejects.toMatchObject({
      response: { code: 'TOKEN_INVALID' },
    });
    await expect(guard.canActivate(ctx(access.token))).resolves.toBe(true);
  });
});
