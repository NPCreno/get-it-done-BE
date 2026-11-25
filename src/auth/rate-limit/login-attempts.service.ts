import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

/** BUG-08: failures that lock one account, the window they count in, the lock. */
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = LOGIN_FAILURE_WINDOW_MS;
/** Bound on tracked identifiers, so random ones cannot grow memory forever. */
export const LOGIN_ATTEMPTS_MAX_KEYS = 10_000;

export function lockoutMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Too many failed attempts for this account. Try again in ${minutes} ${unit}.`;
}

/** 429 for a locked account. LoginLockedFilter adds the Retry-After header. */
export class LoginLockedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: lockoutMessage(retryAfterSeconds),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

interface Entry {
  /** times of the failures still inside the window, oldest first */
  failures: number[];
  /** 0 when not locked */
  lockedUntil: number;
}

/**
 * BUG-08: per-account login lockout. Keyed by identifierKey() (the hashed,
 * normalized email or the exact username), so one account's failures never
 * block another account, whatever IP or proxy they share. Unknown identifiers
 * are tracked the same way, so a lockout says nothing about whether the
 * account exists.
 *
 * In memory, one store per process: valid only while the API runs a single
 * instance (like the throttler store). Logs never carry the identifier, key
 * or IP.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly log = new Logger('rate-limit');
  private readonly entries = new Map<string, Entry>();

  /** Throws LoginLockedException when the key is locked. */
  assertNotLocked(key: string): void {
    const seconds = this.lockedForSeconds(key);
    if (seconds > 0) {
      this.log.warn('login lockout');
      throw new LoginLockedException(seconds);
    }
  }

  /** Seconds left on the lock, rounded up; 0 when not locked. */
  lockedForSeconds(key: string, now = Date.now()): number {
    const entry = this.current(key, now);
    if (!entry || entry.lockedUntil <= now) return 0;
    return Math.ceil((entry.lockedUntil - now) / 1000);
  }

  /** Counts one failure; the LOGIN_FAILURE_LIMIT-th in the window locks the key. */
  recordFailure(key: string, now = Date.now()): void {
    let entry = this.current(key, now);
    if (entry && entry.lockedUntil > now) return; // already locked: no extension
    if (!entry) {
      entry = { failures: [], lockedUntil: 0 };
      this.makeRoom(now);
    }
    entry.failures.push(now);
    if (entry.failures.length >= LOGIN_FAILURE_LIMIT) {
      entry.failures = [];
      entry.lockedUntil = now + LOGIN_LOCK_MS;
    }
    // re-insert so Map order is least recently touched first
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** A successful login clears the key. */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Number of tracked keys (tests). */
  get size(): number {
    return this.entries.size;
  }

  /** The entry with expired failures and an expired lock dropped. */
  private current(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.prune(entry, now);
    if (entry.lockedUntil === 0 && entry.failures.length === 0) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private prune(entry: Entry, now: number): void {
    if (entry.lockedUntil !== 0 && entry.lockedUntil <= now) {
      entry.lockedUntil = 0;
    }
    const cutoff = now - LOGIN_FAILURE_WINDOW_MS;
    while (entry.failures.length > 0 && entry.failures[0] <= cutoff) {
      entry.failures.shift();
    }
  }

  /**
   * Before adding a key at the cap: drop expired entries, then the least
   * recently touched unlocked one (a locked one only if every entry is locked).
   */
  private makeRoom(now: number): void {
    if (this.entries.size < LOGIN_ATTEMPTS_MAX_KEYS) return;
    for (const [k, e] of this.entries) {
      this.prune(e, now);
      if (e.lockedUntil === 0 && e.failures.length === 0)
        this.entries.delete(k);
    }
    if (this.entries.size < LOGIN_ATTEMPTS_MAX_KEYS) return;
    for (const [k, e] of this.entries) {
      if (e.lockedUntil === 0) {
        this.entries.delete(k);
        return;
      }
    }
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}
