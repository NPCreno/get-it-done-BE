import { createHash } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ThrottlerOptions } from '@nestjs/throttler';
import { clientKey, ClientKey } from './client-key';
import { RATE_LIMIT_GROUP, RateLimitGroup } from './rate-limit.decorator';
import { API_CONTRACT } from '../../common/api-contract';
import { isClientId } from '../../oauth/oauth-format';

export const RATE_LIMITS = Symbol('RATE_LIMITS');

export interface LimitSpec {
  limit: number;
  /** window in milliseconds (also the block duration) */
  ttl: number;
}
/** Overrides by throttler name; anything missing uses the default below. */
export type RateLimitOverrides = Record<string, Partial<LimitSpec>>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface ThrottlerDef {
  name: string;
  groups: RateLimitGroup[];
  tracker: string; // 'client' | 'user' | 'pat' | 'oauthClient' | a constant bucket name
  runsFor: 'attested' | 'unattested' | 'noip' | 'user' | 'always';
  limit: number;
  ttl: number;
}

export const THROTTLER_DEFS: ThrottlerDef[] = [
  // BUG-08: login throttlers are backstops only. The main login limit is the
  // per-account lockout (LoginAttemptsService: failed attempts only, so one
  // account's failures never block another). Per attested IP: 30/min and
  // 100/h, enough for several people behind one IP, still a brake on a sweep.
  {
    name: 'login-client-1m',
    groups: ['login'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 30,
    ttl: MIN,
  },
  {
    name: 'login-client-1h',
    groups: ['login'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 100,
    ttl: HOUR,
  },
  // Unattested logins (no INTERNAL_API_SECRET, STATUS U2) share one site-wide
  // bucket. There is no per-socket login limit: on Render the socket is the
  // shared proxy, so it was a site-wide 5/min (BUG-08).
  {
    name: 'login-unattested-1m',
    groups: ['login'],
    tracker: 'unattested',
    runsFor: 'unattested',
    limit: 60,
    ttl: MIN,
  },
  {
    name: 'refresh-client-1m',
    groups: ['refresh'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 60,
    ttl: MIN,
  },
  {
    name: 'refresh-unattested-1m',
    groups: ['refresh'],
    tracker: 'unattested',
    runsFor: 'unattested',
    limit: 30,
    ttl: MIN,
  },
  {
    name: 'logout-client-1m',
    groups: ['logout'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 30,
    ttl: MIN,
  },
  {
    name: 'logout-unattested-1m',
    groups: ['logout'],
    tracker: 'unattested',
    runsFor: 'unattested',
    limit: 30,
    ttl: MIN,
  },
  {
    name: 'signup-client-1h',
    groups: ['signup'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 5,
    ttl: HOUR,
  },
  {
    name: 'signup-client-1d',
    groups: ['signup'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 20,
    ttl: DAY,
  },
  {
    name: 'signup-unattested-1h',
    groups: ['signup'],
    tracker: 'unattested',
    runsFor: 'unattested',
    limit: 10,
    ttl: HOUR,
  },
  // Chat routes run after AuthorizeGuard, so they are keyed on the token user.
  {
    name: 'chat-message-user-1m',
    groups: ['chatMessage'],
    tracker: 'user',
    runsFor: 'user',
    limit: API_CONTRACT.chat.messagesPerMinute,
    ttl: MIN,
  },
  {
    name: 'chat-member-user-1h',
    groups: ['chatMember'],
    tracker: 'user',
    runsFor: 'user',
    limit: 60,
    ttl: HOUR,
  },
  // FEAT-07a: token create runs after AuthorizeGuard (token user).
  {
    name: 'token-create-user-1h',
    groups: ['tokenCreate'],
    tracker: 'user',
    runsFor: 'user',
    limit: API_CONTRACT.tokens.createsPerHour,
    ttl: HOUR,
  },
  // FEAT-07a/07c: /mcp runs after the bearer middleware, keyed on
  // req.auth.clientId (the personal access token id or the OAuth grant id), so
  // each token or connected app has its own budget.
  {
    name: 'mcp-token-1m',
    groups: ['mcp'],
    tracker: 'pat',
    runsFor: 'user',
    limit: 120,
    ttl: MIN,
  },
  // FEAT-07c: DCR. Callers are MCP clients (never the BFF), so every one is
  // keyed by the client key (on Render usually the shared proxy socket) plus a
  // global cap.
  {
    name: 'oauth-register-client-1h',
    groups: ['oauthRegister'],
    tracker: 'client',
    runsFor: 'always',
    limit: API_CONTRACT.oauth.registersPerHour,
    ttl: HOUR,
  },
  {
    name: 'oauth-register-global-1h',
    groups: ['oauthRegister'],
    tracker: 'oauth-register-global',
    runsFor: 'always',
    limit: 200,
    ttl: HOUR,
  },
  // FEAT-07c: token and revoke, keyed on the posted client_id (one bucket for
  // anything that is not a well-formed one), plus a global cap.
  {
    name: 'oauth-token-client-1m',
    groups: ['oauthToken'],
    tracker: 'oauthClient',
    runsFor: 'always',
    limit: API_CONTRACT.oauth.tokenRequestsPerMinute,
    ttl: MIN,
  },
  {
    name: 'oauth-token-global-1m',
    groups: ['oauthToken'],
    tracker: 'oauth-token-global',
    runsFor: 'always',
    limit: 600,
    ttl: MIN,
  },
  // FEAT-07c: the consent decision runs after AuthorizeGuard (token user).
  {
    name: 'oauth-authorize-user-1m',
    groups: ['oauthAuthorize'],
    tracker: 'user',
    runsFor: 'user',
    limit: API_CONTRACT.oauth.authorizePerMinute,
    ttl: MIN,
  },
  {
    name: 'bff-noip-1m',
    groups: ['login', 'refresh', 'logout', 'signup'],
    tracker: 'bff-noip',
    runsFor: 'noip',
    limit: 300,
    ttl: MIN,
  },
];

export const DEFAULT_RATE_LIMITS: RateLimitOverrides = {};

const memo = new WeakMap<object, ClientKey>();
function keyOf(req: Request): ClientKey {
  let k = memo.get(req);
  if (!k) {
    k = clientKey(req);
    memo.set(req, k);
  }
  return k;
}

/** The personal access token id set by the MCP bearer middleware. */
function patOf(req: Record<string, any>): string {
  const id: unknown = (req.auth as { clientId?: unknown } | undefined)
    ?.clientId;
  return typeof id === 'string' && id !== '' ? id : 'unknown';
}

/** The posted OAuth client_id, if well-formed; else one shared bucket. */
function oauthClientOf(req: Record<string, any>): string {
  const id: unknown = (req.body as { client_id?: unknown } | undefined)
    ?.client_id;
  return isClientId(id) ? id : 'invalid';
}

/** The token user set by AuthorizeGuard; one shared bucket if it is missing. */
function userOf(req: Record<string, any>): string {
  const sub: unknown = (req.user as { sub?: unknown } | undefined)?.sub;
  return typeof sub === 'string' && sub !== '' ? sub : 'unknown';
}

const reqOf = (ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<Request>();
const groupOf = (ctx: ExecutionContext): unknown =>
  Reflect.getMetadata(RATE_LIMIT_GROUP, ctx.getHandler());

function skipIfFor(def: ThrottlerDef) {
  return (ctx: ExecutionContext): boolean => {
    if (!def.groups.includes(groupOf(ctx) as RateLimitGroup)) return true;
    const req = reqOf(ctx);
    const { kind } = keyOf(req);
    switch (def.runsFor) {
      case 'attested':
        return kind !== 'attested';
      case 'unattested':
        return kind !== 'unattested';
      case 'noip':
        return kind !== 'bff-noip';
      case 'user':
      case 'always':
        return false;
    }
  };
}

function trackerFor(def: ThrottlerDef) {
  return (req: Record<string, any>): string => {
    if (def.tracker === 'client') return keyOf(req as Request).key;
    if (def.tracker === 'user') return `user:${userOf(req)}`;
    if (def.tracker === 'pat') return `pat:${patOf(req)}`;
    if (def.tracker === 'oauthClient') return `oauth:${oauthClientOf(req)}`;
    return def.tracker;
  };
}

/** Same bucket for every handler of a group: the key omits controller and handler. */
export const generateKey = (
  _ctx: ExecutionContext,
  tracker: string,
  name: string,
) => createHash('sha256').update(`${name}|${tracker}`).digest('hex');

export function buildThrottlers(
  overrides: RateLimitOverrides,
): ThrottlerOptions[] {
  return THROTTLER_DEFS.map((def) => {
    const o = overrides[def.name] ?? {};
    const ttl = o.ttl ?? def.ttl;
    return {
      name: def.name,
      limit: o.limit ?? def.limit,
      ttl,
      blockDuration: ttl,
      skipIf: skipIfFor(def),
      getTracker: trackerFor(def),
      generateKey,
      setHeaders: false,
    };
  });
}
