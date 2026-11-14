import { JwtService } from '@nestjs/jwt';

/**
 * Boot-time environment validation. Pure: returns problems, never prints and
 * never includes a value in a message (names and rules only).
 *
 * `AppEnv` is a diagnostic view of what will run. It is NOT written back to
 * process.env and is not handed to TypeORM, CORS or the JWT code, which keep
 * their own reads and defaults; the defaults here mirror those readers.
 */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SYNCHRONIZE: boolean;
  FRONTEND_URL: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRATION: string;
  JWT_REFRESH_EXPIRATION: string;
  JWT_REFRESH_EXPIRATION_SHORT: string;
  REFRESH_REUSE_GRACE_SECONDS: number;
  INTERNAL_API_SECRET?: string;
}

export interface EnvResult {
  env: AppEnv;
  errors: string[];
  warnings: string[];
}

const NODE_ENVS = ['development', 'test', 'production'] as const;
const MIN_SECRET_LENGTH = 32;

/** Shared by validateEnv and the migration CLI. Returns the rule that failed, never the value. */
export function checkDatabaseUrl(value: string | undefined): string | null {
  if (!value) return 'required';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be a postgres:// or postgresql:// URL';
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    return 'must be a postgres:// or postgresql:// URL';
  if (!url.hostname) return 'must include a host';
  return null;
}

/** For the migration CLI: only DATABASE_URL matters there. */
export function validateDatabaseEnv(raw: NodeJS.ProcessEnv): {
  errors: string[];
} {
  const problem = checkDatabaseUrl(raw.DATABASE_URL);
  return { errors: problem ? [`DATABASE_URL: ${problem}`] : [] };
}

export function formatEnvErrors(errors: string[]): string {
  return `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
}

const isDigits = (v: string) => /^\d+$/.test(v);
const isLocalHost = (host: string) =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '0.0.0.0' ||
  host === '[::1]' ||
  /^127\.\d+\.\d+\.\d+$/.test(host);

/**
 * Checks a jsonwebtoken `expiresIn` string with the real signer. A unit-less
 * numeric string is milliseconds to jsonwebtoken ("3600" = 3.6 s), so it is
 * rejected; zero or negative lifetimes are rejected too.
 */
function checkExpiry(value: string): string | null {
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(value))
    return 'must include a unit, e.g. 3600s, 15m, 1h ("3600" means 3600 milliseconds)';
  const jwt = new JwtService();
  try {
    const token = jwt.sign(
      {},
      { secret: 'probe', expiresIn: value as unknown as number },
    );
    const p = jwt.decode<{ exp?: number; iat?: number }>(token);
    if (!p || typeof p.exp !== 'number' || typeof p.iat !== 'number')
      return 'is not a valid duration, e.g. 15m, 1h, 3600s, 7d';
    if (p.exp - p.iat <= 0) return 'must be a positive duration of at least 1s';
    return null;
  } catch {
    return 'is not a valid duration, e.g. 15m, 1h, 3600s, 7d';
  }
}

function checkFrontendUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be an absolute http(s) URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'must be an absolute http(s) URL';
  if (!url.hostname) return 'must include a host';
  if (value !== url.origin)
    return 'must be an origin only (scheme://host[:port]: no path, query, hash, credentials or trailing slash)';
  return null;
}

export function validateEnv(raw: NodeJS.ProcessEnv): EnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (name: string, rule: string) => errors.push(`${name}: ${rule}`);

  // NODE_ENV
  let nodeEnv: AppEnv['NODE_ENV'] = 'development';
  const rawNodeEnv = raw.NODE_ENV;
  const onRailway = !!(raw.RAILWAY_ENVIRONMENT_NAME || raw.RAILWAY_PROJECT_ID);
  if (rawNodeEnv === undefined || rawNodeEnv === '') {
    if (onRailway)
      err(
        'NODE_ENV',
        'must be set explicitly on Railway (expected "production")',
      );
  } else if ((NODE_ENVS as readonly string[]).includes(rawNodeEnv)) {
    nodeEnv = rawNodeEnv as AppEnv['NODE_ENV'];
  } else {
    err('NODE_ENV', 'must be one of development, test, production');
  }
  const isProd = nodeEnv === 'production';

  // PORT
  let port = 8000;
  if (raw.PORT !== undefined) {
    const n = isDigits(raw.PORT) ? Number(raw.PORT) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n;
    else err('PORT', 'must be a whole number from 1 to 65535');
  }

  // Database
  const dbProblem = checkDatabaseUrl(raw.DATABASE_URL);
  if (dbProblem) err('DATABASE_URL', dbProblem);

  let sync = false;
  if (raw.DATABASE_SYNCHRONIZE !== undefined) {
    if (raw.DATABASE_SYNCHRONIZE === 'true') sync = true;
    else if (raw.DATABASE_SYNCHRONIZE !== 'false')
      err('DATABASE_SYNCHRONIZE', 'must be exactly "true" or "false"');
  }
  if (sync && isProd)
    err('DATABASE_SYNCHRONIZE', 'must not be "true" when NODE_ENV=production');

  // FRONTEND_URL
  let frontend = 'http://localhost:3000';
  if (raw.FRONTEND_URL === undefined || raw.FRONTEND_URL === '') {
    if (isProd) err('FRONTEND_URL', 'required when NODE_ENV=production');
  } else {
    const problem = checkFrontendUrl(raw.FRONTEND_URL);
    if (problem) {
      err('FRONTEND_URL', problem);
    } else {
      frontend = raw.FRONTEND_URL;
      if (isProd && isLocalHost(new URL(frontend).hostname)) {
        if (raw.FRONTEND_URL_ALLOW_LOCAL === 'true')
          warnings.push(
            'FRONTEND_URL_ALLOW_LOCAL=true: a local FRONTEND_URL is accepted in production mode',
          );
        else
          err(
            'FRONTEND_URL',
            'must not be a local address when NODE_ENV=production (set FRONTEND_URL_ALLOW_LOCAL=true only for a local smoke test)',
          );
      }
    }
  }

  // Secrets
  if (!raw.JWT_SECRET) err('JWT_SECRET', 'required');
  if (!raw.JWT_REFRESH_SECRET) err('JWT_REFRESH_SECRET', 'required');
  if (isProd) {
    for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const v = raw[k];
      if (v && v.length < MIN_SECRET_LENGTH)
        warnings.push(
          `${k}: shorter than ${MIN_SECRET_LENGTH} characters; rotate it to a longer random value`,
        );
    }
    if (raw.JWT_SECRET && raw.JWT_SECRET === raw.JWT_REFRESH_SECRET)
      warnings.push(
        'JWT_SECRET and JWT_REFRESH_SECRET are identical; use two different secrets',
      );
  }
  if (!raw.INTERNAL_API_SECRET)
    warnings.push(
      'INTERNAL_API_SECRET is not set: client IPs will not be recorded.',
    );

  // Expiries
  let access = '';
  if (!raw.JWT_ACCESS_EXPIRATION) err('JWT_ACCESS_EXPIRATION', 'required');
  else {
    access = raw.JWT_ACCESS_EXPIRATION;
    const p = checkExpiry(access);
    if (p) err('JWT_ACCESS_EXPIRATION', p);
  }
  const optionalExpiry = (name: string, fallback: string): string => {
    const v = raw[name];
    if (v === undefined) return fallback;
    const p = checkExpiry(v);
    if (p) err(name, p);
    return v;
  };
  const refresh = optionalExpiry('JWT_REFRESH_EXPIRATION', '7d');
  const refreshShort = optionalExpiry('JWT_REFRESH_EXPIRATION_SHORT', '1d');

  // Refresh reuse grace
  let grace = 30;
  if (raw.REFRESH_REUSE_GRACE_SECONDS !== undefined) {
    const n = isDigits(raw.REFRESH_REUSE_GRACE_SECONDS)
      ? Number(raw.REFRESH_REUSE_GRACE_SECONDS)
      : NaN;
    if (Number.isInteger(n) && n >= 0 && n <= 3600) grace = n;
    else
      err(
        'REFRESH_REUSE_GRACE_SECONDS',
        'must be a whole number from 0 to 3600',
      );
  }

  return {
    env: {
      NODE_ENV: nodeEnv,
      PORT: port,
      DATABASE_URL: raw.DATABASE_URL ?? '',
      DATABASE_SYNCHRONIZE: sync,
      FRONTEND_URL: frontend,
      JWT_SECRET: raw.JWT_SECRET ?? '',
      JWT_REFRESH_SECRET: raw.JWT_REFRESH_SECRET ?? '',
      JWT_ACCESS_EXPIRATION: access,
      JWT_REFRESH_EXPIRATION: refresh,
      JWT_REFRESH_EXPIRATION_SHORT: refreshShort,
      REFRESH_REUSE_GRACE_SECONDS: grace,
      INTERNAL_API_SECRET: raw.INTERNAL_API_SECRET || undefined,
    },
    errors,
    warnings,
  };
}
