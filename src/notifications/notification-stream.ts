import { MessageEvent } from '@nestjs/common';
import { interval, map, merge, Observable, takeUntil, timer } from 'rxjs';

export const HEARTBEAT_MS = 25_000;

/**
 * Adds an idle heartbeat so proxies keep the connection, and ends the stream
 * at the credential's expiry so it never outlives its token.
 */
export function withHeartbeatAndExpiry(
  live: Observable<MessageEvent>,
  opts: { heartbeatMs?: number; expiresAtMs?: number; now?: () => number } = {},
): Observable<MessageEvent> {
  const ping = interval(opts.heartbeatMs ?? HEARTBEAT_MS).pipe(
    map((): MessageEvent => ({ type: 'ping', data: '' })),
  );
  const merged = merge(live, ping);
  if (opts.expiresAtMs === undefined) return merged;
  const now = opts.now ?? Date.now;
  return merged.pipe(takeUntil(timer(Math.max(0, opts.expiresAtMs - now()))));
}
