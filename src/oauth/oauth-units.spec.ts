import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { generatePat } from 'src/tokens/pat-format';
import { McpTokenVerifier } from 'src/mcp/mcp-token-verifier';
import type { PatVerifier } from 'src/mcp/pat-verifier';
import type {
  OAuthGrantsService,
  VerifiedAccess,
} from './oauth-grants.service';
import {
  authorizationServerMetadata,
  issuerFrom,
  oauthUrls,
  protectedResourceMetadata,
} from './oauth-config';
import {
  codeHashOf,
  generateClientId,
  generateCode,
  generateToken,
  isClientId,
  parseToken,
  pkceMatches,
  pkceS256,
} from './oauth-format';
import {
  AuthorizeParams,
  cleanClientName,
  KnownClient,
  parseScope,
  redirectMatches,
  redirectUriProblem,
  validateAuthorize,
  validateRegistration,
} from './oauth-params';

const URLS = {
  issuer: 'https://api.example.com',
  resource: 'https://api.example.com/mcp',
};
const CLIENT: KnownClient = {
  id: '11111111-1111-4111-8111-111111111111',
  client_id: 'gid_cli_AAAAAAAAAAAAAAAAAAAAAA',
  client_name: 'Claude',
  redirect_uris: [
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost/callback',
  ],
};
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const good = (over: AuthorizeParams = {}): AuthorizeParams => ({
  response_type: 'code',
  client_id: CLIENT.client_id,
  redirect_uri: CLIENT.redirect_uris[0],
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  scope: 'mcp offline_access',
  state: 'st-1',
  resource: URLS.resource,
  ...over,
});

describe('OAuth formats (FEAT-07c)', () => {
  it('PKCE S256 matches the RFC 7636 appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(pkceS256(verifier)).toBe(CHALLENGE);
    expect(pkceMatches(verifier, CHALLENGE)).toBe(true);
    expect(pkceMatches(`${verifier}x`, CHALLENGE)).toBe(false);
    expect(pkceMatches('short', pkceS256('short'))).toBe(false);
    expect(pkceMatches(undefined, CHALLENGE)).toBe(false);
  });

  it('access and refresh tokens have their own markers and parse back', () => {
    const a = generateToken('access');
    const r = generateToken('refresh');
    expect(a.token).toMatch(/^gid_oat_[0-9A-Za-z]{10}_[A-Za-z0-9_-]{43}$/);
    expect(r.token).toMatch(/^gid_ort_[0-9A-Za-z]{10}_[A-Za-z0-9_-]{43}$/);
    expect(a.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseToken(a.token, 'access')?.prefix).toBe(a.prefix);
    expect(parseToken(a.token, 'refresh')).toBeNull();
    expect(parseToken(r.token, 'access')).toBeNull();
    expect(parseToken(generatePat().token, 'access')).toBeNull();
    expect(parseToken(`${a.token}x`, 'access')).toBeNull();
    expect(parseToken(42, 'access')).toBeNull();
  });

  it('client ids and codes', () => {
    const id = generateClientId();
    expect(isClientId(id)).toBe(true);
    expect(isClientId('gid_cli_x')).toBe(false);
    expect(isClientId(['gid_cli_AAAAAAAAAAAAAAAAAAAAAA'])).toBe(false);
    const { code, codeHash } = generateCode();
    expect(codeHashOf(code)).toBe(codeHash);
    expect(codeHashOf('nope')).toBeNull();
    expect(codeHashOf(undefined)).toBeNull();
  });
});

describe('redirect URIs (FEAT-07c)', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:33418/callback',
    'http://127.0.0.1/callback',
    'http://[::1]:5000/cb?x=1',
  ])('accepts %s', (u) => expect(redirectUriProblem(u)).toBeNull());

  it.each([
    ['fragment', 'https://claude.ai/cb#x'],
    ['userinfo', 'https://user:pw@claude.ai/cb'],
    ['http non-loopback', 'http://claude.ai/cb'],
    ['http lookalike', 'http://localhost.evil.com/cb'],
    ['custom scheme', 'com.example.app:/cb'],
    ['javascript', 'javascript:alert(1)'],
    ['relative', '/cb'],
    ['empty', ''],
    ['not a string', 7],
  ])('refuses %s', (_name, u) => expect(redirectUriProblem(u)).not.toBeNull());

  it('matches exactly, ignoring only the port of a loopback http URI', () => {
    const reg = ['https://claude.ai/cb', 'http://127.0.0.1/callback'];
    expect(redirectMatches(reg, 'https://claude.ai/cb')).toBe(true);
    expect(redirectMatches(reg, 'https://claude.ai/cb/')).toBe(false);
    expect(redirectMatches(reg, 'https://claude.ai:8443/cb')).toBe(false);
    expect(redirectMatches(reg, 'https://claude.ai/cb?x=1')).toBe(false);
    expect(redirectMatches(reg, 'http://127.0.0.1:51234/callback')).toBe(true);
    expect(redirectMatches(reg, 'http://127.0.0.1:51234/other')).toBe(false);
    expect(redirectMatches(reg, 'http://localhost:51234/callback')).toBe(false);
    expect(
      redirectMatches(
        ['http://localhost:9/callback'],
        'http://localhost:7/callback',
      ),
    ).toBe(true);
    expect(redirectMatches(reg, 'https://127.0.0.1:51234/callback')).toBe(
      false,
    );
  });
});

describe('client registration (FEAT-07c)', () => {
  it('a public client with a cleaned name', () => {
    const r = validateRegistration({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: '  Claude\u0000\u0007 ',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      },
    });
  });

  it('names: default, trimmed, capped at 100 characters', () => {
    expect(cleanClientName(undefined)).toBe('Unnamed app');
    expect(cleanClientName('   ')).toBe('Unnamed app');
    expect(cleanClientName('x'.repeat(150))).toHaveLength(100);
  });

  it.each([
    [{}, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [
      { redirect_uris: Array(6).fill('https://a.example/cb') },
      'invalid_redirect_uri',
    ],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['myapp://cb'] }, 'invalid_redirect_uri'],
    [
      {
        redirect_uris: ['https://a.example/cb'],
        grant_types: ['client_credentials'],
      },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], response_types: ['token'] },
      'invalid_client_metadata',
    ],
  ])('refuses %j', (body, error) => {
    const r = validateRegistration(body);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(error);
  });
});

describe('authorize parameters (FEAT-07c)', () => {
  it('scopes: subset of mcp offline_access; mcp always; empty = mcp', () => {
    expect(parseScope(undefined)).toEqual(['mcp']);
    expect(parseScope('')).toEqual(['mcp']);
    expect(parseScope('offline_access')).toEqual(['mcp', 'offline_access']);
    expect(parseScope('offline_access  mcp')).toEqual([
      'mcp',
      'offline_access',
    ]);
    expect(parseScope('mcp admin')).toBeNull();
  });

  it('a valid request', () => {
    const r = validateAuthorize(good(), CLIENT, URLS);
    expect(r).toEqual({
      ok: true,
      value: {
        client: CLIENT,
        redirectUri: CLIENT.redirect_uris[0],
        scopes: ['mcp', 'offline_access'],
        codeChallenge: CHALLENGE,
        state: 'st-1',
        resource: URLS.resource,
      },
    });
    // resource is optional; a loopback redirect may use any port
    const loop = validateAuthorize(
      good({
        resource: undefined,
        redirect_uri: 'http://localhost:4567/callback',
      }),
      CLIENT,
      URLS,
    );
    expect(loop.ok).toBe(true);
  });

  it('unknown client and unregistered redirect URI are fatal (no redirect)', () => {
    const noClient = validateAuthorize(good(), null, URLS);
    expect(noClient).toMatchObject({
      ok: false,
      fatal: true,
      error: 'invalid_client',
    });
    for (const redirect_uri of [
      undefined,
      'https://evil.example/cb',
      'https://claude.ai/api/mcp/auth_callback#x',
    ]) {
      const r = validateAuthorize(good({ redirect_uri }), CLIENT, URLS);
      expect(r).toMatchObject({ ok: false, fatal: true });
      expect(r).not.toHaveProperty('redirectTo');
    }
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ response_type: undefined }, 'unsupported_response_type'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge_method: undefined }, 'invalid_request'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge: 'x'.repeat(42) }, 'invalid_request'],
    [{ code_challenge: 'x'.repeat(129) }, 'invalid_request'],
    [{ scope: 'mcp write' }, 'invalid_scope'],
    [{ resource: 'https://other.example.com/mcp' }, 'invalid_target'],
    [{ state: 's'.repeat(2001) }, 'invalid_request'],
  ])('%j goes back to the client as %s', (over, error) => {
    const r = validateAuthorize(good(over), CLIENT, URLS);
    expect(r).toMatchObject({ ok: false, fatal: false, error });
    if (r.ok || r.fatal) throw new Error('expected a redirectable error');
    const back = new URL(r.redirectTo);
    expect(back.origin + back.pathname).toBe(CLIENT.redirect_uris[0]);
    expect(back.searchParams.get('error')).toBe(error);
    expect(back.searchParams.get('iss')).toBe(URLS.issuer);
    if ((over as AuthorizeParams).state === undefined)
      expect(back.searchParams.get('state')).toBe('st-1');
  });
});

describe('metadata (FEAT-07c)', () => {
  it('the issuer: RENDER_EXTERNAL_URL, then PUBLIC_API_URL, then localhost', () => {
    expect(
      issuerFrom({
        RENDER_EXTERNAL_URL: 'https://get-it-done-be.onrender.com',
        PUBLIC_API_URL: 'http://localhost:9000',
      }),
    ).toBe('https://get-it-done-be.onrender.com');
    expect(issuerFrom({ PUBLIC_API_URL: 'http://localhost:9000/' })).toBe(
      'http://localhost:9000',
    );
    expect(issuerFrom({ PORT: '8123' })).toBe('http://localhost:8123');
    expect(issuerFrom({})).toBe('http://localhost:8000');
  });

  it('production documents', () => {
    const urls = oauthUrls({
      RENDER_EXTERNAL_URL: 'https://get-it-done-be.onrender.com',
      FRONTEND_URL: 'https://get-it-done.vercel.app',
    });
    expect(protectedResourceMetadata(urls)).toEqual({
      resource: 'https://get-it-done-be.onrender.com/mcp',
      authorization_servers: ['https://get-it-done-be.onrender.com'],
      scopes_supported: ['mcp', 'offline_access'],
      bearer_methods_supported: ['header'],
    });
    const as = authorizationServerMetadata(urls);
    expect(as).toEqual({
      issuer: 'https://get-it-done-be.onrender.com',
      authorization_endpoint: 'https://get-it-done.vercel.app/oauth/authorize',
      token_endpoint: 'https://get-it-done-be.onrender.com/oauth/token',
      registration_endpoint:
        'https://get-it-done-be.onrender.com/oauth/register',
      revocation_endpoint: 'https://get-it-done-be.onrender.com/oauth/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp', 'offline_access'],
    });
    expect(as).not.toHaveProperty('client_id_metadata_document_supported');
    expect(urls.resourceMetadata).toBe(
      'https://get-it-done-be.onrender.com/.well-known/oauth-protected-resource/mcp',
    );
  });
});

describe('McpTokenVerifier dispatch (FEAT-07c)', () => {
  const access: VerifiedAccess = {
    grantId: '22222222-2222-4222-8222-222222222222',
    tokenId: '33333333-3333-4333-8333-333333333333',
    pairId: '44444444-4444-4444-8444-444444444444',
    userId: 'USR-1',
    prefix: 'ABCDEFGHIJ',
    scopes: ['mcp', 'offline_access'],
    expiresAt: new Date(Date.now() + 3600_000),
  };
  function setup(found: VerifiedAccess | null) {
    const pats = {
      verifyAccessToken: jest.fn().mockResolvedValue({
        token: 't',
        clientId: 'pat-id',
        scopes: ['mcp'],
        expiresAt: 1,
        extra: { userId: 'USR-2', prefix: 'PPPPPPPPPP' },
      }),
    };
    const grants = {
      verifyAccess: jest.fn().mockResolvedValue(found),
      touch: jest.fn().mockResolvedValue(undefined),
    };
    const v = new McpTokenVerifier(
      pats as unknown as PatVerifier,
      grants as unknown as OAuthGrantsService,
    );
    return { v, pats, grants };
  }
  const rejects = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
  };

  it('gid_pat_ goes to the PAT verifier, marked kind pat', async () => {
    const { v, pats, grants } = setup(null);
    const info = await v.verifyAccessToken(generatePat().token);
    expect(pats.verifyAccessToken).toHaveBeenCalled();
    expect(grants.verifyAccess).not.toHaveBeenCalled();
    expect(info.extra).toEqual({
      userId: 'USR-2',
      prefix: 'PPPPPPPPPP',
      kind: 'pat',
    });
  });

  it('gid_oat_ goes to the grants: grant id, scopes, expiry, kind oauth', async () => {
    const { v, pats, grants } = setup(access);
    const info = await v.verifyAccessToken(generateToken('access').token);
    expect(pats.verifyAccessToken).not.toHaveBeenCalled();
    expect(grants.touch).toHaveBeenCalledWith(access);
    expect(info.clientId).toBe(access.grantId);
    expect(info.scopes).toEqual(['mcp', 'offline_access']);
    expect(info.expiresAt).toBe(Math.floor(access.expiresAt.getTime() / 1000));
    expect(info.extra).toEqual({
      userId: 'USR-1',
      prefix: 'ABCDEFGHIJ',
      kind: 'oauth',
    });
  });

  it('an unknown oat, a refresh token, a JWT and junk are invalid_token', async () => {
    const { v, pats } = setup(null);
    await rejects(v.verifyAccessToken(generateToken('access').token));
    await rejects(v.verifyAccessToken(generateToken('refresh').token));
    await rejects(v.verifyAccessToken('eyJhbGciOiJIUzI1NiJ9.e30.x'));
    await rejects(v.verifyAccessToken('junk'));
    expect(pats.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('a failing touch never blocks the request', async () => {
    const { v, grants } = setup(access);
    grants.touch.mockRejectedValue(new Error('db down'));
    const info = await v.verifyAccessToken(generateToken('access').token);
    expect(info.clientId).toBe(access.grantId);
  });
});
