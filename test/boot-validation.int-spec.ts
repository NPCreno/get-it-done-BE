/**
 * Boots the real src/main.ts in a child process with a controlled environment
 * and a temp cwd: invalid config must exit 1 before AppModule is loaded.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resetDatabase } from './int-db';

const ROOT = resolve(__dirname, '..');
const MAIN = join(ROOT, 'src', 'main.ts');
const BOOT_DB = 'getitdone_test_boot';

const validEnv = (): Record<string, string> => ({
  DATABASE_URL: `${BASE_URL}/${BOOT_DB}`,
  DATABASE_SYNCHRONIZE: 'true',
  JWT_SECRET: 'test-access-secret-0123456789-0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-0123456789',
  JWT_ACCESS_EXPIRATION: '15m',
  INTERNAL_API_SECRET: 'internal',
  FRONTEND_URL: 'http://localhost:3000',
  PORT: '8123',
});

interface Run {
  code: number | null;
  out: string;
}

/** Runs main.ts; resolves on exit, or kills it once `until` matches the output. */
function runMain(
  env: Record<string, string>,
  cwd: string,
  opts: { until?: RegExp; timeoutMs: number },
): Promise<Run> {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        '-r',
        require.resolve('tsconfig-paths/register'),
        MAIN,
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot ?? '',
          TS_NODE_PROJECT: join(ROOT, 'tsconfig.json'),
          TS_NODE_TRANSPILE_ONLY: 'true',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      res({ code, out });
    };
    const onData = (d: Buffer) => {
      out += d.toString();
      if (opts.until?.test(out)) {
        child.kill();
        finish(null);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => finish(code));
    const timer = setTimeout(() => {
      child.kill();
      finish(-1);
    }, opts.timeoutMs);
  });
}

describe('boot validation (src/main.ts)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'boot-'));
  });
  afterEach(() => {
    try {
      // On Windows a just-killed child can still hold its cwd; a leftover temp dir is harmless.
      rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* ignore */
    }
  });

  it('B1 missing JWT_SECRET: exit 1, clear message, AppModule never loaded', async () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>).JWT_SECRET;
    const r = await runMain(env, cwd, { timeoutMs: 60000 });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Invalid environment configuration:');
    expect(r.out).toContain('JWT_SECRET: required');
    expect(r.out).not.toMatch(/\[Nest\]|TypeOrmModule|NestFactory/);
  }, 90000);

  it('B2 invalid DATABASE_URL: exit 1 with no connection attempt', async () => {
    const r = await runMain(
      { ...validEnv(), DATABASE_URL: 'mysql://u:pw@127.0.0.1:1/db' },
      cwd,
      { timeoutMs: 60000 },
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('DATABASE_URL: must be a postgres://');
    expect(r.out).not.toMatch(/TypeOrm|ECONNREFUSED|Unable to connect/i);
    expect(r.out).not.toContain('pw');
  }, 90000);

  it('B3 real environment wins over .env; .env fills only missing variables', async () => {
    writeFileSync(
      join(cwd, '.env'),
      'PORT=abc\nJWT_REFRESH_SECRET=from-file\n',
    );
    const env = validEnv();
    delete (env as Record<string, string | undefined>).JWT_REFRESH_SECRET;
    const r = await runMain(
      { ...env, PORT: '8001', NODE_ENV: 'staging' },
      cwd,
      {
        timeoutMs: 60000,
      },
    );
    expect(r.code).toBe(1);
    const lines = r.out.split('\n').filter((l) => l.startsWith('  - '));
    expect(lines).toEqual([
      '  - NODE_ENV: must be one of development, test, production',
    ]);
  }, 90000);

  it('B4 a valid configuration boots', async () => {
    await resetDatabase(BASE_URL, BOOT_DB);
    const r = await runMain(validEnv(), cwd, {
      until: /Nest application successfully started/,
      timeoutMs: 90000,
    });
    expect(r.out).toContain('[Env] configuration valid (NODE_ENV=development)');
    expect(r.out).toContain('Nest application successfully started');
  }, 120000);
});

// keep the shared test DB name referenced so int-env side effects stay imported
void API_TEST_DB;
