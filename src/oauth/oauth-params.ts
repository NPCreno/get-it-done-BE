import { API_CONTRACT } from 'src/common/api-contract';

/**
 * Pure OAuth parameter rules (FEAT-07c): client registration, redirect URI
 * matching and the authorize request. No database, no Nest.
 */
export type OAuthScope = (typeof API_CONTRACT.oauth.scopes)[number];
const SCOPES: readonly string[] = API_CONTRACT.oauth.scopes;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REDIRECT_URI_MAX = 2000;
const CHALLENGE_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE_MAX = 2000;

// ---------------------------------------------------------------- redirects

export function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Why a redirect URI cannot be registered, or null when it can. `https`
 * anywhere, or `http` on a loopback host (RFC 8252); no fragment, no
 * userinfo, no custom or private-use schemes (yet).
 */
export function redirectUriProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value === '')
    return 'each redirect URI must be a non-empty string';
  if (value.length > REDIRECT_URI_MAX) return 'redirect URI is too long';
  if (value.includes('#')) return 'redirect URI must not have a fragment';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'redirect URI must be an absolute URL';
  }
  if (url.username || url.password)
    return 'redirect URI must not carry credentials';
  if (url.protocol === 'https:') return url.hostname ? null : 'missing host';
  if (url.protocol === 'http:')
    return isLoopbackHttp(url)
      ? null
      : 'http redirect URIs are allowed only on localhost, 127.0.0.1 or [::1]';
  return 'redirect URI must use https (or http on a loopback host)';
}

/**
 * True when `given` is one of the registered URIs: an exact string match, or,
 * for http on a loopback host, a match on everything but the port (RFC 8252
 * 7.3: native apps listen on a random port).
 */
export function redirectMatches(
  registered: readonly string[],
  given: string,
): boolean {
  if (registered.includes(given)) return true;
  if (redirectUriProblem(given) !== null) return false;
  const g = new URL(given);
  if (!isLoopbackHttp(g)) return false;
  return registered.some((r) => {
    let u: URL;
    try {
      u = new URL(r);
    } catch {
      return false;
    }
    return (
      isLoopbackHttp(u) &&
      u.hostname === g.hostname &&
      u.pathname === g.pathname &&
      u.search === g.search
    );
  });
}

// ------------------------------------------------------------- registration

export interface ClientRegistration {
  client_name: string;
  redirect_uris: string[];
}

export type Registered =
  | { ok: true; value: ClientRegistration }
  | {
      ok: false;
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    };

/** Trimmed, control characters removed, 1-100 characters, else the default. */
export function cleanClientName(value: unknown): string {
  if (typeof value !== 'string') return API_CONTRACT.oauth.defaultClientName;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (cleaned === '') return API_CONTRACT.oauth.defaultClientName;
  return [...cleaned].slice(0, API_CONTRACT.oauth.clientNameMax).join('');
}

const ALLOWED_GRANTS = new Set(['authorization_code', 'refresh_token']);

/**
 * RFC 7591 request rules. Always a public client: whatever auth method is
 * asked for, the response says `none`.
 */
export function validateRegistration(body: unknown): Registered {
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const uris = b.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length < 1 ||
    uris.length > API_CONTRACT.oauth.redirectUrisMax
  )
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description: `redirect_uris must list 1 to ${API_CONTRACT.oauth.redirectUrisMax} URIs`,
    };
  for (const u of uris) {
    const problem = redirectUriProblem(u);
    if (problem)
      return { ok: false, error: 'invalid_redirect_uri', description: problem };
  }
  if (b.grant_types !== undefined) {
    if (
      !Array.isArray(b.grant_types) ||
      !b.grant_types.every(
        (g) => typeof g === 'string' && ALLOWED_GRANTS.has(g),
      )
    )
      return {
        ok: false,
        error: 'invalid_client_metadata',
        description:
          'grant_types may contain only authorization_code and refresh_token',
      };
  }
  if (b.response_types !== undefined) {
    if (
      !Array.isArray(b.response_types) ||
      !b.response_types.every((r) => r === 'code')
    )
      return {
        ok: false,
        error: 'invalid_client_metadata',
        description: 'response_types may contain only code',
      };
  }
  return {
    ok: true,
    value: {
      client_name: cleanClientName(b.client_name),
      redirect_uris: [...new Set(uris as string[])],
    },
  };
}

// ---------------------------------------------------------------- authorize

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
}

export interface KnownClient {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

export interface ValidAuthorize {
  client: KnownClient;
  redirectUri: string;
  scopes: OAuthScope[];
  codeChallenge: string;
  state: string | undefined;
  resource: string;
}

export type AuthorizeError =
  | { fatal: true; error: string; description: string }
  | {
      fatal: false;
      error: string;
      description: string;
      redirectTo: string;
    };

export type AuthorizeResult =
  | { ok: true; value: ValidAuthorize }
  | ({ ok: false } & AuthorizeError);

/** Space-separated scopes, a subset of `mcp offline_access`; `mcp` always. */
export function parseScope(scope: string | undefined): OAuthScope[] | null {
  const asked = (scope ?? '').split(' ').filter((s) => s !== '');
  if (!asked.every((s) => SCOPES.includes(s))) return null;
  return SCOPES.filter(
    (s) => s === API_CONTRACT.oauth.defaultScope || asked.includes(s),
  ) as OAuthScope[];
}

/** The resource as the client named it, compared without a trailing slash. */
export function resourceMatches(given: string, resource: string): boolean {
  const strip = (v: string) => (v.endsWith('/') ? v.slice(0, -1) : v);
  return strip(given) === strip(resource);
}

/** `redirectUri` with the given query parameters added (existing ones kept). */
export function withParams(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Validates an authorize request. An unknown client or an unregistered
 * redirect URI is fatal: never redirect to an unverified URI. Everything
 * else is reported to the client through its redirect URI (`error=`, with
 * `state` and `iss`).
 */
export function validateAuthorize(
  p: AuthorizeParams,
  client: KnownClient | null,
  urls: { issuer: string; resource: string },
): AuthorizeResult {
  if (!client)
    return {
      ok: false,
      fatal: true,
      error: 'invalid_client',
      description: 'This app is not registered. Start the connection again.',
    };
  const redirectUri = p.redirect_uri;
  if (
    !redirectUri ||
    redirectUri.length > REDIRECT_URI_MAX ||
    !redirectMatches(client.redirect_uris, redirectUri)
  )
    return {
      ok: false,
      fatal: true,
      error: 'invalid_request',
      description: "The app's redirect address is not registered.",
    };
  const state = p.state;
  const fail = (error: string, description: string): AuthorizeResult => ({
    ok: false,
    fatal: false,
    error,
    description,
    redirectTo: withParams(redirectUri, {
      error,
      error_description: description,
      state,
      iss: urls.issuer,
    }),
  });
  if (state !== undefined && state.length > STATE_MAX)
    return fail('invalid_request', 'state is too long');
  if (p.response_type !== 'code')
    return fail('unsupported_response_type', 'response_type must be code');
  if (p.code_challenge_method !== 'S256')
    return fail('invalid_request', 'code_challenge_method must be S256');
  if (!p.code_challenge || !CHALLENGE_RE.test(p.code_challenge))
    return fail(
      'invalid_request',
      'code_challenge must be 43 to 128 characters',
    );
  const scopes = parseScope(p.scope);
  if (!scopes)
    return fail(
      'invalid_scope',
      'scope may contain only mcp and offline_access',
    );
  if (p.resource !== undefined && !resourceMatches(p.resource, urls.resource))
    return fail('invalid_target', 'resource is not this server');
  return {
    ok: true,
    value: {
      client,
      redirectUri,
      scopes,
      codeChallenge: p.code_challenge,
      state,
      resource: urls.resource,
    },
  };
}
