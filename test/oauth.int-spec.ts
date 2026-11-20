/**
 * FEAT-07c: OAuth for MCP connectors, end to end against the real app and
 * Postgres: discovery, DCR, the consent API, the token endpoint (PKCE, code
 * reuse, refresh rotation and its retry grace), revocation, /mcp with OAuth
 * access tokens, rate limits, the cleanup cron, and the SDK's own OAuth
 * client provider connecting and listing the 21 tools.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes } from 'crypto';
import {
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import { connectMcp, createPat, listen, rawInitialize } from './mcp-helpers';
import { pkceS256 } from '../src/oauth/oauth-format';
import { OAuthMaintenanceService } from '../src/oauth/oauth-maintenance.service';
import { OAuthMetadataController } from '../src/oauth/oauth-metadata.controller';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/**
 * On the developer's Windows machine something in the network stack rewrites
 * every loopback HTTP response whose URL contains `/mcp` (it adds
 * `transfer-encoding: chunked` and drops Content-Length; a bare Node server
 * shows the same), so a plain JSON GET of the path-aware metadata cannot be
 * parsed there. CI (Linux, CI=true) reads it over HTTP; locally the same
 * handler is called in-process. Responses read only for status/headers, and
 * the streamed /mcp responses, are unaffected. A request carrying the
 * `MCP-Protocol-Version` header is rewritten the same way, so the local SDK
 * test drops that header on the OAuth endpoints (which ignore it).
 */
const MCP_PATHS_OVER_TCP = process.env.CI === 'true';

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceS256(verifier) };
}

describe('OAuth for MCP connectors (FEAT-07c)', () => {
  let app: INestApplication;
  let base: string;
  let RESOURCE: string;
  let A: TestUser;
  let B: TestUser;
  const S = () => app.getHttpServer();
  const previousIssuer = process.env.PUBLIC_API_URL;

  beforeAll(async () => {
    app = await createTestApp();
    base = await listen(app);
    // The issuer follows the listening port, as the SDK client checks that
    // the protected resource is the URL it connects to.
    process.env.PUBLIC_API_URL = base;
    RESOURCE = `${base}/mcp`;
    A = await signupAndLogin(app, 'oauth_a');
    B = await signupAndLogin(app, 'oauth_b');
  }, 60000);

  afterAll(async () => {
    process.env.PUBLIC_API_URL = previousIssuer;
    await app?.close();
  });

  async function register(redirect = REDIRECT, name = 'Test Client') {
    const r = await request(S())
      .post('/oauth/register')
      .send({ client_name: name, redirect_uris: [redirect] });
    expect(r.status).toBe(201);
    return r.body.client_id as string;
  }

  const params = (
    clientId: string,
    challenge: string,
    over: Record<string, string | undefined> = {},
  ) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp offline_access',
    state: 'state-123',
    resource: RESOURCE,
    ...over,
  });

  const decide = (
    user: TestUser,
    p: Record<string, unknown>,
    decision: 'allow' | 'deny' = 'allow',
  ) =>
    request(S())
      .post('/api/oauth/authorize')
      .set(bearer(user))
      .send({ ...p, decision });

  async function codeFor(user: TestUser, p: Record<string, unknown>) {
    const r = await decide(user, p);
    expect(r.status).toBe(200);
    const back = new URL(r.body.data.redirect_to as string);
    return back.searchParams.get('code')!;
  }

  const token = (body: Record<string, string>) =>
    request(S()).post('/oauth/token').type('form').send(body);

  const exchange = (
    clientId: string,
    code: string,
    verifier: string,
    over: Record<string, string> = {},
  ) =>
    token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      ...over,
    });

  const refresh = (clientId: string, rt: string) =>
    token({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: rt,
    });

  /** register -> allow -> token, for `user`. */
  async function connect(user: TestUser = A) {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const code = await codeFor(user, params(clientId, challenge));
    const r = await exchange(clientId, code, verifier);
    expect(r.status).toBe(200);
    const grants = await q(
      `SELECT g.id FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
        WHERE c.client_id = $1`,
      [clientId],
    );
    return {
      clientId,
      tokens: r.body as Tokens,
      grantId: grants[0].id as string,
    };
  }

  const mcpStatus = async (accessToken: string) =>
    (await rawInitialize(base, { Authorization: `Bearer ${accessToken}` }))
      .status;

  describe('discovery', () => {
    it('protected-resource metadata, both paths, CORS *, cacheable', async () => {
      const expected = {
        resource: RESOURCE,
        authorization_servers: [base],
        scopes_supported: ['mcp', 'offline_access'],
        bearer_methods_supported: ['header'],
      };
      expect(app.get(OAuthMetadataController).resourceForMcp()).toEqual(
        expected,
      );
      for (const path of [
        ...(MCP_PATHS_OVER_TCP
          ? ['/.well-known/oauth-protected-resource/mcp']
          : []),
        '/.well-known/oauth-protected-resource',
      ]) {
        const r = await request(S())
          .get(path)
          .set('Origin', 'http://localhost:6274');
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
          resource: RESOURCE,
          authorization_servers: [base],
          scopes_supported: ['mcp', 'offline_access'],
          bearer_methods_supported: ['header'],
        });
        expect(r.headers['access-control-allow-origin']).toBe('*');
        expect(r.headers['access-control-allow-credentials']).toBeUndefined();
        expect(r.headers['cache-control']).toBe('public, max-age=300');
      }
    });

    it('authorization-server metadata', async () => {
      const r = await request(S()).get(
        '/.well-known/oauth-authorization-server',
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        issuer: base,
        authorization_endpoint: 'http://localhost:3000/oauth/authorize',
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mcp', 'offline_access'],
      });
      expect(r.body).not.toHaveProperty(
        'client_id_metadata_document_supported',
      );
    });

    it('a 401 on /mcp names the metadata, the scope and the error', async () => {
      const res = await rawInitialize(base, {});
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer error="invalid_token", error_description="Missing Authorization header", scope="mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      );
    });

    it('preflight on the token endpoint is open; /api/oauth keeps the site CORS', async () => {
      const pre = await request(S())
        .options('/oauth/token')
        .set('Origin', 'http://localhost:6274')
        .set('Access-Control-Request-Method', 'POST');
      expect(pre.status).toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe('*');
      const site = await request(S())
        .get('/api/oauth/grants')
        .set('Origin', 'https://evil.example')
        .set(bearer(A));
      expect(site.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    });
  });

  describe('registration', () => {
    it('a public client; no-store; the secret method is ignored', async () => {
      const r = await request(S())
        .post('/oauth/register')
        .set('Origin', 'http://localhost:6274')
        .send({
          client_name: 'Claude',
          redirect_uris: [REDIRECT, 'http://localhost/callback'],
          token_endpoint_auth_method: 'client_secret_post',
        });
      expect(r.status).toBe(201);
      expect(Object.keys(r.body).sort()).toEqual(
        [
          'client_id',
          'client_id_issued_at',
          'client_name',
          'redirect_uris',
          'grant_types',
          'response_types',
          'token_endpoint_auth_method',
        ].sort(),
      );
      expect(r.body.client_id).toMatch(/^gid_cli_[A-Za-z0-9_-]{22}$/);
      expect(r.body.token_endpoint_auth_method).toBe('none');
      expect(r.body).not.toHaveProperty('client_secret');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['access-control-allow-origin']).toBe('*');
    });

    it('bad redirect URIs: RFC 7591 error shape, no-store', async () => {
      for (const redirect_uris of [
        [],
        ['http://evil.example/cb'],
        ['https://a.example/cb#frag'],
        ['myapp://cb'],
      ]) {
        const r = await request(S())
          .post('/oauth/register')
          .send({ redirect_uris });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_redirect_uri');
        expect(typeof r.body.error_description).toBe('string');
        expect(r.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('consent API', () => {
    it('check: what the consent page shows (exact shape)', async () => {
      const clientId = await register(REDIRECT, 'Claude');
      const r = await request(S())
        .get('/api/oauth/authorize/check')
        .query(params(clientId, pkce().challenge))
        .set(bearer(A));
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toEqual({
        status: 'success',
        data: {
          client_name: 'Claude',
          redirect_host: 'claude.ai',
          loopback_only: false,
          scopes: ['mcp', 'offline_access'],
        },
      });
    });

    it('check needs the website JWT', async () => {
      const r = await request(S())
        .get('/api/oauth/authorize/check')
        .query(params(await register(), pkce().challenge));
      expect(r.status).toBe(401);
    });

    it('a loopback redirect on any port (Claude Code)', async () => {
      const clientId = await register(
        'http://localhost/callback',
        'Claude Code',
      );
      const r = await request(S())
        .get('/api/oauth/authorize/check')
        .query(
          params(clientId, pkce().challenge, {
            redirect_uri: 'http://localhost:51234/callback',
          }),
        )
        .set(bearer(A));
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({
        redirect_host: 'localhost',
        loopback_only: true,
      });
    });

    it('deny -> access_denied with state, no grant', async () => {
      const clientId = await register();
      const r = await decide(A, params(clientId, pkce().challenge), 'deny');
      expect(r.status).toBe(200);
      const back = new URL(r.body.data.redirect_to);
      expect(back.origin + back.pathname).toBe(REDIRECT);
      expect(back.searchParams.get('error')).toBe('access_denied');
      expect(back.searchParams.get('state')).toBe('state-123');
      expect(back.searchParams.get('code')).toBeNull();
      const grants = await q(
        `SELECT 1 FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
          WHERE c.client_id = $1`,
        [clientId],
      );
      expect(grants).toHaveLength(0);
    });

    it('allow -> exactly { redirect_to } with code, state and iss', async () => {
      const clientId = await register();
      const r = await decide(A, params(clientId, pkce().challenge));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        status: 'success',
        data: { redirect_to: expect.any(String) },
      });
      const back = new URL(r.body.data.redirect_to);
      expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(back.searchParams.get('state')).toBe('state-123');
      expect(back.searchParams.get('iss')).toBe(base);
    });

    it('fatal errors never redirect (check and decision)', async () => {
      const clientId = await register();
      const cases = [
        params('gid_cli_AAAAAAAAAAAAAAAAAAAAAA', pkce().challenge),
        params('not-a-client', pkce().challenge),
        params(clientId, pkce().challenge, {
          redirect_uri: 'https://evil.example/cb',
        }),
        params(clientId, pkce().challenge, { redirect_uri: undefined }),
      ];
      for (const p of cases) {
        const check = await request(S())
          .get('/api/oauth/authorize/check')
          .query(p)
          .set(bearer(A));
        expect(check.status).toBe(400);
        expect(check.body).toMatchObject({ statusCode: 400, fatal: true });
        expect(check.body).not.toHaveProperty('redirect_to');
        const d = await decide(A, p);
        expect(d.status).toBe(400);
        expect(d.body.fatal).toBe(true);
        expect(d.body).not.toHaveProperty('redirect_to');
      }
    });

    it('redirectable errors: 400 with fatal false and redirect_to (exact shape)', async () => {
      const clientId = await register();
      const r = await request(S())
        .get('/api/oauth/authorize/check')
        .query(
          params(clientId, pkce().challenge, {
            code_challenge_method: 'plain',
          }),
        )
        .set(bearer(A));
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        statusCode: 400,
        error: 'invalid_request',
        message: 'code_challenge_method must be S256',
        fatal: false,
        redirect_to: expect.any(String),
      });
      const back = new URL(r.body.redirect_to);
      expect(back.searchParams.get('error')).toBe('invalid_request');
      expect(back.searchParams.get('state')).toBe('state-123');
      // the decision re-validates: allow is refused the same way
      const d = await decide(
        A,
        params(clientId, pkce().challenge, {
          resource: 'https://other.example/mcp',
        }),
      );
      expect(d.status).toBe(400);
      expect(d.body).toMatchObject({ fatal: false, error: 'invalid_target' });
    });
  });

  describe('token endpoint', () => {
    it('register -> check -> allow -> token -> tools/list', async () => {
      const { tokens } = await connect(A);
      expect(tokens).toEqual({
        access_token: expect.stringMatching(/^gid_oat_/),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: expect.stringMatching(/^gid_ort_/),
        scope: 'mcp offline_access',
      });
      const client = await connectMcp(base, tokens.access_token);
      try {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(21);
        const me = await client.callTool({
          name: 'get_profile',
          arguments: {},
        });
        expect(JSON.stringify(me.structuredContent)).toContain(A.username);
      } finally {
        await client.close();
      }
      // nothing secret is stored in clear
      const rows = await q(`SELECT secret_hash FROM oauth_tokens`);
      for (const r of rows) {
        expect(r.secret_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(tokens.access_token).not.toContain(r.secret_hash);
      }
    });

    it('token responses are no-store with CORS *', async () => {
      const r = await token({ grant_type: 'password' }).set(
        'Origin',
        'http://localhost:6274',
      );
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: 'unsupported_grant_type',
        error_description: expect.any(String),
      });
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['access-control-allow-origin']).toBe('*');
    });

    it('unknown client -> 401 invalid_client', async () => {
      const r = await token({
        grant_type: 'authorization_code',
        client_id: 'gid_cli_AAAAAAAAAAAAAAAAAAAAAA',
        code: 'x',
        code_verifier: 'y',
        redirect_uri: REDIRECT,
      });
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('invalid_client');
    });

    it('PKCE mismatch, wrong redirect_uri, wrong client -> invalid_grant; wrong resource -> invalid_target', async () => {
      const clientId = await register();
      const other = await register();
      const cases: [Record<string, string>, string, string?][] = [
        [{ code_verifier: pkce().verifier }, 'invalid_grant'],
        [{ redirect_uri: 'https://claude.ai/other' }, 'invalid_grant'],
        [{}, 'invalid_grant', other],
        [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      ];
      for (const [over, error, asClient] of cases) {
        const { verifier, challenge } = pkce();
        const code = await codeFor(A, params(clientId, challenge));
        const r = await exchange(asClient ?? clientId, code, verifier, over);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe(error);
      }
    });

    it('an expired code -> invalid_grant', async () => {
      const clientId = await register();
      const { verifier, challenge } = pkce();
      const code = await codeFor(A, params(clientId, challenge));
      await q(
        `UPDATE oauth_codes SET expires_at = now() - interval '1 second'`,
      );
      const r = await exchange(clientId, code, verifier);
      expect(r.body.error).toBe('invalid_grant');
    });

    it('code reuse revokes the grant: the first access token now gets 401', async () => {
      const clientId = await register();
      const { verifier, challenge } = pkce();
      const code = await codeFor(A, params(clientId, challenge));
      const first = await exchange(clientId, code, verifier);
      expect(first.status).toBe(200);
      expect(await mcpStatus(first.body.access_token)).toBe(200);
      const again = await exchange(clientId, code, verifier);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('invalid_grant');
      expect(await mcpStatus(first.body.access_token)).toBe(401);
      const r = await refresh(clientId, first.body.refresh_token);
      expect(r.body.error).toBe('invalid_grant');
    });

    it('refresh rotates; the old one retried within the grace window is an idempotent retry', async () => {
      const { clientId, tokens: t1 } = await connect(A);
      const r2 = await refresh(clientId, t1.refresh_token);
      expect(r2.status).toBe(200);
      const t2 = r2.body as Tokens;
      expect(t2.refresh_token).not.toBe(t1.refresh_token);
      expect(t2.expires_in).toBe(3600);
      // The client lost r2's answer and retries with the old token.
      const r3 = await refresh(clientId, t1.refresh_token);
      expect(r3.status).toBe(200);
      const t3 = r3.body as Tokens;
      // the unused replacement pair is gone; the new one works
      expect(await mcpStatus(t2.access_token)).toBe(401);
      expect((await refresh(clientId, t2.refresh_token)).body.error).toBe(
        'invalid_grant',
      );
      expect(await mcpStatus(t3.access_token)).toBe(200);
      // the replacement has now been used: the old token again is theft
      const reuse = await refresh(clientId, t1.refresh_token);
      expect(reuse.body.error).toBe('invalid_grant');
      expect(await mcpStatus(t3.access_token)).toBe(401);
      expect((await refresh(clientId, t3.refresh_token)).body.error).toBe(
        'invalid_grant',
      );
    });

    it('reuse after the grace window revokes the grant', async () => {
      const { clientId, grantId, tokens: t1 } = await connect(A);
      const t2 = (await refresh(clientId, t1.refresh_token)).body as Tokens;
      await q(
        `UPDATE oauth_tokens SET rotated_at = now() - interval '2 minutes'
          WHERE grant_id = $1 AND rotated_at IS NOT NULL`,
        [grantId],
      );
      const reuse = await refresh(clientId, t1.refresh_token);
      expect(reuse.body.error).toBe('invalid_grant');
      expect(await mcpStatus(t2.access_token)).toBe(401);
      const [g] = await q(`SELECT revoked_at FROM oauth_grants WHERE id = $1`, [
        grantId,
      ]);
      expect(g.revoked_at).not.toBeNull();
    });

    it('a refresh token from another client revokes the grant', async () => {
      const { tokens, grantId } = await connect(A);
      const other = await register();
      const r = await refresh(other, tokens.refresh_token);
      expect(r.body.error).toBe('invalid_grant');
      const [g] = await q(`SELECT revoked_at FROM oauth_grants WHERE id = $1`, [
        grantId,
      ]);
      expect(g.revoked_at).not.toBeNull();
    });

    it('an expired access token gets 401 with the full WWW-Authenticate header', async () => {
      const { tokens, grantId } = await connect(A);
      await q(
        `UPDATE oauth_tokens SET expires_at = now() - interval '1 second'
          WHERE grant_id = $1 AND kind = 'access'`,
        [grantId],
      );
      const res = await rawInitialize(base, {
        Authorization: `Bearer ${tokens.access_token}`,
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer error="invalid_token", error_description="Invalid, expired or revoked token", scope="mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      );
      // the refresh token still works
      const r = await refresh(
        (
          await q(
            `SELECT c.client_id FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id WHERE g.id = $1`,
            [grantId],
          )
        )[0].client_id,
        tokens.refresh_token,
      );
      expect(r.status).toBe(200);
    });

    it('a token issued for another resource is refused on /mcp', async () => {
      const { tokens, grantId } = await connect(A);
      await q(`UPDATE oauth_grants SET resource = $2 WHERE id = $1`, [
        grantId,
        'https://other.example/mcp',
      ]);
      expect(await mcpStatus(tokens.access_token)).toBe(401);
    });

    it('a soft-deleted user: tokens stop working', async () => {
      const C = await signupAndLogin(app, 'oauth_c');
      const { clientId, tokens } = await connect(C);
      expect(await mcpStatus(tokens.access_token)).toBe(200);
      await q(`UPDATE users SET "deletedAt" = now() WHERE user_id = $1`, [
        C.user_id,
      ]);
      expect(await mcpStatus(tokens.access_token)).toBe(401);
      expect((await refresh(clientId, tokens.refresh_token)).body.error).toBe(
        'invalid_grant',
      );
    });
  });

  describe('revocation', () => {
    it('/oauth/revoke: an access token alone; a refresh token ends the grant; always 200', async () => {
      const { clientId, tokens } = await connect(A);
      const revoke = (body: Record<string, string>) =>
        request(S()).post('/oauth/revoke').type('form').send(body);
      // another client cannot revoke it
      const other = await register();
      expect(
        (await revoke({ token: tokens.access_token, client_id: other })).status,
      ).toBe(200);
      expect(await mcpStatus(tokens.access_token)).toBe(200);
      expect(
        (await revoke({ token: tokens.access_token, client_id: clientId }))
          .status,
      ).toBe(200);
      expect(await mcpStatus(tokens.access_token)).toBe(401);
      const t2 = (await refresh(clientId, tokens.refresh_token)).body as Tokens;
      expect(await mcpStatus(t2.access_token)).toBe(200);
      expect(
        (await revoke({ token: t2.refresh_token, client_id: clientId })).status,
      ).toBe(200);
      expect(await mcpStatus(t2.access_token)).toBe(401);
      expect(
        (await revoke({ token: 'junk', client_id: clientId })).status,
      ).toBe(200);
      expect((await revoke({})).status).toBe(200);
    });

    it('Connected apps: list (exact shape), revoke -> 401 on /mcp, idempotent, foreign 404', async () => {
      const D = await signupAndLogin(app, 'oauth_d');
      const { tokens, grantId } = await connect(D);
      // an abandoned consent (never exchanged) is not listed
      await codeFor(D, params(await register(), pkce().challenge));
      const list = await request(S()).get('/api/oauth/grants').set(bearer(D));
      expect(list.status).toBe(200);
      expect(list.headers['cache-control']).toBe('no-store');
      expect(list.body).toEqual({
        status: 'success',
        data: [
          {
            id: grantId,
            client_name: 'Test Client',
            redirect_host: 'claude.ai',
            created_at: expect.any(String),
            last_used_at: null,
          },
        ],
      });
      expect(await mcpStatus(tokens.access_token)).toBe(200);
      const used = await request(S()).get('/api/oauth/grants').set(bearer(D));
      expect(used.body.data[0].last_used_at).toEqual(expect.any(String));

      const foreign = await request(S())
        .delete(`/api/oauth/grants/${grantId}`)
        .set(bearer(B));
      expect(foreign.status).toBe(404);
      expect(
        (await request(S()).delete('/api/oauth/grants/nope').set(bearer(D)))
          .status,
      ).toBe(404);

      const del = await request(S())
        .delete(`/api/oauth/grants/${grantId}`)
        .set(bearer(D));
      expect(del.status).toBe(200);
      expect(del.body.data.id).toBe(grantId);
      expect(Object.keys(del.body.data).sort()).toEqual(
        [
          'id',
          'client_name',
          'redirect_host',
          'created_at',
          'last_used_at',
        ].sort(),
      );
      expect(await mcpStatus(tokens.access_token)).toBe(401);
      const again = await request(S())
        .delete(`/api/oauth/grants/${grantId}`)
        .set(bearer(D));
      expect(again.status).toBe(200);
      const after = await request(S()).get('/api/oauth/grants').set(bearer(D));
      expect(after.body.data).toEqual([]);
    });
  });

  describe('token boundaries', () => {
    it('a PAT still works on /mcp; a website JWT is 401 there', async () => {
      const pat = await createPat(app, A);
      expect(await mcpStatus(pat.token)).toBe(200);
      expect(await mcpStatus(A.access)).toBe(401);
    });

    it('an OAuth access or refresh token on a REST route is 401', async () => {
      const { tokens } = await connect(A);
      for (const t of [tokens.access_token, tokens.refresh_token]) {
        const r = await request(S())
          .get('/api/oauth/grants')
          .set('Authorization', `Bearer ${t}`);
        expect(r.status).toBe(401);
      }
    });
  });

  describe('cleanup cron', () => {
    it('deletes only rows past their margins', async () => {
      const keep = await connect(A);
      const old = await connect(A);
      const stale = await register();
      // an abandoned consent from two days ago
      await codeFor(A, params(stale, pkce().challenge));
      await q(
        `UPDATE oauth_grants SET created_at = now() - interval '2 days'
          WHERE client_id = (SELECT id FROM oauth_clients WHERE client_id = $1)`,
        [stale],
      );
      await q(
        `UPDATE oauth_codes SET expires_at = now() - interval '2 days'
          WHERE grant_id IN (SELECT g.id FROM oauth_grants g
                              JOIN oauth_clients c ON c.id = g.client_id
                             WHERE c.client_id = $1)`,
        [stale],
      );
      await q(
        `UPDATE oauth_grants SET revoked_at = now() - interval '31 days' WHERE id = $1`,
        [old.grantId],
      );
      await q(
        `UPDATE oauth_tokens SET expires_at = now() - interval '8 days'
          WHERE grant_id = $1 AND kind = 'access'`,
        [keep.grantId],
      );
      const orphan = await register();
      await q(
        `UPDATE oauth_clients SET created_at = now() - interval '8 days' WHERE client_id = $1`,
        [orphan],
      );

      const counts = await app.get(OAuthMaintenanceService).cleanup();
      expect(counts.codes).toBeGreaterThanOrEqual(1);
      expect(counts.tokens).toBeGreaterThanOrEqual(1);
      expect(counts.grants).toBeGreaterThanOrEqual(2);
      expect(counts.clients).toBeGreaterThanOrEqual(1);
      const ids = (await q(`SELECT id FROM oauth_grants`)).map((r) => r.id);
      expect(ids).toContain(keep.grantId);
      expect(ids).not.toContain(old.grantId);
      expect(
        await q(`SELECT 1 FROM oauth_clients WHERE client_id = $1`, [orphan]),
      ).toHaveLength(0);
      // the kept grant's refresh token still works
      const r = await refresh(keep.clientId, keep.tokens.refresh_token);
      expect(r.status).toBe(200);
    });
  });

  describe('SDK OAuth client provider', () => {
    class TestProvider implements OAuthClientProvider {
      info: any;
      saved: any;
      verifier = '';
      authUrl?: URL;
      get redirectUrl() {
        return 'http://localhost:4545/callback';
      }
      get clientMetadata() {
        return {
          client_name: 'SDK test client',
          redirect_uris: ['http://localhost:4545/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
      }
      clientInformation() {
        return this.info;
      }
      saveClientInformation(i: any) {
        this.info = i;
      }
      tokens() {
        return this.saved;
      }
      saveTokens(t: any) {
        this.saved = t;
      }
      redirectToAuthorization(url: URL) {
        this.authUrl = url;
      }
      saveCodeVerifier(v: string) {
        this.verifier = v;
      }
      codeVerifier() {
        return this.verifier;
      }
    }

    it('discovers, registers, signs in through the consent API and lists 21 tools', async () => {
      const provider = new TestProvider();
      const url = new URL(`${base}/mcp`);
      // See MCP_PATHS_OVER_TCP: locally, read the identical root document,
      // and rebuild fixed-length /mcp answers (the 401) from what arrived.
      const fetchFn: typeof fetch = async (input, init) => {
        const u = String(input instanceof Request ? input.url : input);
        if (MCP_PATHS_OVER_TCP) return fetch(u, init);
        const target = u.replace(
          '/.well-known/oauth-protected-resource/mcp',
          '/.well-known/oauth-protected-resource',
        );
        const headers0 = new Headers(init?.headers);
        if (!target.endsWith('/mcp')) headers0.delete('mcp-protocol-version');
        const res = await fetch(target, { ...init, headers: headers0 });
        if (
          !u.endsWith('/mcp') ||
          res.headers.get('content-type')?.includes('event-stream')
        )
          return res;
        const body = await res.text().catch(() => '');
        const headers = new Headers(res.headers);
        headers.delete('transfer-encoding');
        return new Response(body === '' ? null : body, {
          status: res.status,
          headers,
        });
      };
      const first = new Client({ name: 'sdk-oauth', version: '1.0.0' });
      const t1 = new StreamableHTTPClientTransport(url, {
        authProvider: provider,
        fetch: fetchFn,
      });
      await expect(first.connect(t1)).rejects.toThrow();
      expect(provider.info.client_id).toMatch(/^gid_cli_/);
      const auth = provider.authUrl!;
      expect(`${auth.origin}${auth.pathname}`).toBe(
        'http://localhost:3000/oauth/authorize',
      );
      const p = Object.fromEntries(auth.searchParams.entries());
      expect(p.code_challenge_method).toBe('S256');
      expect(p.resource).toBe(RESOURCE);

      // The FE consent page: check, then allow, with the website JWT.
      const check = await request(S())
        .get('/api/oauth/authorize/check')
        .query(p)
        .set(bearer(A));
      expect(check.status).toBe(200);
      expect(check.body.data.client_name).toBe('SDK test client');
      const d = await decide(A, p);
      expect(d.status).toBe(200);
      const back = new URL(d.body.data.redirect_to);
      expect(back.searchParams.get('state')).toBe(p.state ?? null);
      await t1.finishAuth(back.searchParams);
      expect(provider.saved.access_token).toMatch(/^gid_oat_/);
      expect(provider.saved.refresh_token).toMatch(/^gid_ort_/);

      const second = new Client({ name: 'sdk-oauth', version: '1.0.0' });
      await second.connect(
        new StreamableHTTPClientTransport(url, {
          authProvider: provider,
          fetch: fetchFn,
        }),
      );
      try {
        const { tools } = await second.listTools();
        expect(tools).toHaveLength(21);
      } finally {
        await second.close();
      }
    });
  });
});

describe('OAuth rate limits (FEAT-07c)', () => {
  let app: INestApplication;
  const previousIssuer = process.env.PUBLIC_API_URL;
  beforeAll(async () => {
    app = await createTestApp({});
  }, 60000);
  afterAll(async () => {
    process.env.PUBLIC_API_URL = previousIssuer;
    await app?.close();
  });

  it('register: 20/h per client key -> 429, RFC shape and Retry-After', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/oauth/register')
        .send({ redirect_uris: [REDIRECT] });
    for (let i = 0; i < 20; i++) expect((await send()).status).toBe(201);
    const r = await send();
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      error: 'temporarily_unavailable',
      error_description: expect.any(String),
    });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('token: 60/min per client_id -> 429; another client is unaffected', async () => {
    const send = (client_id: string) =>
      request(app.getHttpServer())
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'refresh_token', client_id, refresh_token: 'x' });
    const a = 'gid_cli_AAAAAAAAAAAAAAAAAAAAAA';
    const b = 'gid_cli_BBBBBBBBBBBBBBBBBBBBBB';
    for (let i = 0; i < 60; i++) expect((await send(a)).status).toBe(401);
    expect((await send(a)).status).toBe(429);
    expect((await send(b)).status).toBe(401);
  });

  it('authorize decision: 30/min per user -> 429', async () => {
    const U = await signupAndLogin(app, 'oauth_rl');
    const send = () =>
      request(app.getHttpServer())
        .post('/api/oauth/authorize')
        .set(bearer(U))
        .send({ decision: 'deny', client_id: 'nope' });
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(400);
    const r = await send();
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });
});
