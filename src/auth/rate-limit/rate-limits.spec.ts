import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { buildThrottlers, generateKey, THROTTLER_DEFS } from './rate-limits';
import { RATE_LIMIT_GROUP } from './rate-limit.decorator';

function ctx(group: string | undefined, req: Partial<Request>) {
  const handler = () => undefined;
  if (group) Reflect.defineMetadata(RATE_LIMIT_GROUP, group, handler);
  return {
    getHandler: () => handler,
    getClass: () => class X {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
const attested = () =>
  ({
    headers: { 'x-internal-secret': 's', 'x-client-ip': '1.2.3.4' },
    body: { username: 'u' },
    socket: {},
  }) as unknown as Request;

describe('throttler config (U4)', () => {
  beforeAll(() => {
    process.env.INTERNAL_API_SECRET = 's';
  });
  afterAll(() => {
    delete process.env.INTERNAL_API_SECRET;
  });

  it('every name is unique and belongs to known groups', () => {
    const names = THROTTLER_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of THROTTLER_DEFS) {
      if (d.name === 'bff-noip-1m') {
        expect([...d.groups].sort()).toEqual(
          ['login', 'logout', 'refresh', 'signup'].sort(),
        );
      } else {
        expect(d.groups).toHaveLength(1);
      }
    }
  });

  it('skipIf is true for another group and for a handler with no group', () => {
    const throttlers = buildThrottlers({});
    const loginClient = throttlers.find((t) => t.name === 'login-client-1m')!;
    const skip = loginClient.skipIf!;
    expect(skip(ctx('login', attested()))).toBe(false);
    expect(skip(ctx('refresh', attested()))).toBe(true);
    expect(skip(ctx(undefined, attested()))).toBe(true);
  });

  it('only one set of throttlers runs per group', () => {
    const running = (group: string) =>
      buildThrottlers({})
        .filter((t) => !t.skipIf!(ctx(group, attested())))
        .map((t) => t.name);
    expect(running('login')).toEqual([
      'login-client-1m',
      'login-client-1h',
      'login-identifier-15m',
    ]);
    expect(running('refresh')).toEqual(['refresh-client-1m']);
    expect(running('logout')).toEqual(['logout-client-1m']);
    expect(running('signup')).toEqual(['signup-client-1h', 'signup-client-1d']);
    expect(running('chatMessage')).toEqual(['chat-message-user-1m']);
    expect(running('chatMember')).toEqual(['chat-member-user-1h']);
    expect(running('tokenCreate')).toEqual(['token-create-user-1h']);
    expect(running('mcp')).toEqual(['mcp-token-1m']);
    expect(running('oauthRegister')).toEqual([
      'oauth-register-client-1h',
      'oauth-register-global-1h',
    ]);
    expect(running('oauthToken')).toEqual([
      'oauth-token-client-1m',
      'oauth-token-global-1m',
    ]);
    expect(running('oauthAuthorize')).toEqual(['oauth-authorize-user-1m']);
  });

  it('the OAuth token throttler keys on a well-formed posted client_id only (FEAT-07c)', () => {
    const t = buildThrottlers({}).find(
      (i) => i.name === 'oauth-token-client-1m',
    )!;
    expect(t.limit).toBe(60);
    const tracker = t.getTracker as (r: Record<string, any>) => string;
    const id = 'gid_cli_AAAAAAAAAAAAAAAAAAAAAA';
    expect(tracker({ body: { client_id: id } })).toBe(`oauth:${id}`);
    expect(tracker({ body: { client_id: 'x'.repeat(500) } })).toBe(
      'oauth:invalid',
    );
    expect(tracker({ body: { client_id: [id] } })).toBe('oauth:invalid');
    expect(tracker({})).toBe('oauth:invalid');
  });

  it('chat throttlers key on the token user, never the IP', () => {
    const t = buildThrottlers({});
    const msg = t.find((i) => i.name === 'chat-message-user-1m')!;
    expect(msg.limit).toBe(30);
    expect(msg.ttl).toBe(60_000);
    const tracker = msg.getTracker as (r: Record<string, any>) => string;
    expect(tracker({ ...attested(), user: { sub: 'u1' } })).toBe('user:u1');
    expect(tracker({ ...attested(), user: { sub: 'u2' } })).toBe('user:u2');
    expect(tracker(attested())).toBe('user:unknown');
  });

  it('the mcp throttler keys on the personal access token id', () => {
    const t = buildThrottlers({}).find((i) => i.name === 'mcp-token-1m')!;
    expect([t.limit, t.ttl]).toEqual([120, 60_000]);
    const tracker = t.getTracker as (r: Record<string, any>) => string;
    expect(tracker({ ...attested(), auth: { clientId: 't1' } })).toBe('pat:t1');
    expect(tracker(attested())).toBe('pat:unknown');
    const create = buildThrottlers({}).find(
      (i) => i.name === 'token-create-user-1h',
    )!;
    expect([create.limit, create.ttl]).toEqual([10, 3_600_000]);
  });

  it('generateKey ignores the handler and separates names', () => {
    const a = ctx('login', attested());
    const b = ctx('login', attested());
    expect(generateKey(a, 'ip:1', 'n')).toBe(generateKey(b, 'ip:1', 'n'));
    expect(generateKey(a, 'ip:1', 'n')).not.toBe(generateKey(a, 'ip:1', 'm'));
  });

  it('applies overrides and always blocks for the window', () => {
    const t = buildThrottlers({ 'login-client-1m': { limit: 2, ttl: 1000 } });
    const x = t.find((i) => i.name === 'login-client-1m')!;
    expect([x.limit, x.ttl, x.blockDuration]).toEqual([2, 1000, 1000]);
  });
});
