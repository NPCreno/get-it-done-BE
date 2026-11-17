import { createHash } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ThrottlerOptions } from '@nestjs/throttler';
import { clientKey, ClientKey } from './client-key';
import { identifierKey } from './identifier-key';
import { RATE_LIMIT_GROUP, RateLimitGroup } from './rate-limit.decorator';
import { API_CONTRACT } from '../../common/api-contract';

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
  tracker: string; // 'client' | 'identifier' | 'user' | a constant bucket name
  runsFor: 'attested' | 'unattested' | 'noip' | 'identifier' | 'user';
  limit: number;
  ttl: number;
}

export const THROTTLER_DEFS: ThrottlerDef[] = [
  {
    name: 'login-client-1m',
    groups: ['login'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 10,
    ttl: MIN,
  },
  {
    name: 'login-client-1h',
    groups: ['login'],
    tracker: 'client',
    runsFor: 'attested',
    limit: 50,
    ttl: HOUR,
  },
  {
    name: 'login-identifier-15m',
    groups: ['login'],
    tracker: 'identifier',
    runsFor: 'identifier',
    limit: 10,
    ttl: 15 * MIN,
  },
  {
    name: 'login-unattested-1m',
    groups: ['login'],
    tracker: 'unattested',
    runsFor: 'unattested',
    limit: 30,
    ttl: MIN,
  },
  {
    name: 'login-xri-1m',
    groups: ['login'],
    tracker: 'client',
    runsFor: 'unattested',
    limit: 5,
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
      case 'identifier':
        return identifierKey(req.body) === null;
      case 'user':
        return false;
    }
  };
}

function trackerFor(def: ThrottlerDef) {
  return (req: Record<string, any>): string => {
    if (def.tracker === 'client') return keyOf(req as Request).key;
    if (def.tracker === 'identifier') return identifierKey(req.body) ?? '';
    if (def.tracker === 'user') return `user:${userOf(req)}`;
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
