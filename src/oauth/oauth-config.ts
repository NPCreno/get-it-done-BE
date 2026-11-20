import { API_CONTRACT } from 'src/common/api-contract';

/**
 * Where this API lives, for OAuth (FEAT-07c). Read on every call (no caching)
 * so tests can point it at a listening port.
 *  - issuer: Render's automatic RENDER_EXTERNAL_URL, else PUBLIC_API_URL,
 *    else http://localhost:<PORT>. Always an origin (no path, no slash).
 *  - resource: `<issuer>/mcp`, exactly the URL users paste into a connector
 *    (production: https://get-it-done-be.onrender.com/mcp).
 *  - authorization endpoint: the website's consent page on FRONTEND_URL.
 */
export interface OAuthUrls {
  issuer: string;
  resource: string;
  resourceMetadata: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
}

/** The origin of an http(s) URL, or null. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function issuerFrom(env: NodeJS.ProcessEnv): string {
  return (
    originOf(env.RENDER_EXTERNAL_URL) ??
    originOf(env.PUBLIC_API_URL) ??
    `http://localhost:${env.PORT || 8000}`
  );
}

export function oauthUrls(env: NodeJS.ProcessEnv = process.env): OAuthUrls {
  const issuer = issuerFrom(env);
  const frontend = originOf(env.FRONTEND_URL) ?? 'http://localhost:3000';
  return {
    issuer,
    resource: `${issuer}/mcp`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    authorizationEndpoint: `${frontend}${API_CONTRACT.oauth.authorizePath}`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
  };
}

/** RFC 9728 protected-resource metadata. No database access. */
export function protectedResourceMetadata(urls: OAuthUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...API_CONTRACT.oauth.scopes],
    bearer_methods_supported: ['header'],
  };
}

/**
 * RFC 8414 authorization-server metadata. No CIMD
 * (`client_id_metadata_document_supported`) yet: clients register via DCR.
 */
export function authorizationServerMetadata(urls: OAuthUrls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    token_endpoint: urls.tokenEndpoint,
    registration_endpoint: urls.registrationEndpoint,
    revocation_endpoint: urls.revocationEndpoint,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...API_CONTRACT.oauth.scopes],
  };
}
