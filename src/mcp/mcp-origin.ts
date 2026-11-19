import type { NextFunction, Request, Response } from 'express';

/**
 * DNS-rebinding protection for /mcp (FEAT-07a). A request that carries an
 * `Origin` header must name one of MCP_ALLOWED_ORIGINS exactly (scheme, host
 * and port); empty by default, so every browser origin is refused. Non-browser
 * MCP clients send no Origin and pass.
 */
export function parseAllowedOrigins(value: string | undefined): {
  origins: string[];
  error: string | null;
} {
  if (value === undefined || value.trim() === '')
    return { origins: [], error: null };
  const origins: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      return { origins: [], error: 'each entry must be an http(s) origin' };
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== entry
    )
      return {
        origins: [],
        error:
          'each entry must be an origin only (scheme://host[:port], comma-separated)',
      };
    origins.push(url.origin);
  }
  return { origins, error: null };
}

/** True when the request has no Origin, or an allowed one. */
export function originAllowed(
  origin: string | string[] | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  return normalized === origin && allowed.includes(normalized);
}

/** Express middleware: 403 (JSON-RPC error body) for a disallowed Origin. */
export function mcpOriginCheck(allowed: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (originAllowed(req.headers.origin, allowed)) return next();
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Forbidden: Origin not allowed' },
      id: null,
    });
  };
}
