/** BUG-08: per-account login lockout (fake clock through the `now` argument). */
import { Logger } from '@nestjs/common';
import {
  LOGIN_ATTEMPTS_MAX_KEYS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCK_MS,
  LoginAttemptsService,
  LoginLockedException,
  lockoutMessage,
} from './login-attempts.service';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

describe('LoginAttemptsService (BUG-08)', () => {
  let s: LoginAttemptsService;
  beforeEach(() => {
    s = new LoginAttemptsService();
  });
  const fail = (key: string, times: number, at = T0) => {
    for (let i = 0; i < times; i++) s.recordFailure(key, at);
  };

  it('uses the planned numbers', () => {
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * MIN);
    expect(LOGIN_LOCK_MS).toBe(15 * MIN);
    expect(LOGIN_ATTEMPTS_MAX_KEYS).toBe(10_000);
  });

  it('4 failures do not lock; the 5th locks for about 15 minutes', () => {
    fail('a', 4);
    expect(s.lockedForSeconds('a', T0)).toBe(0);
    s.recordFailure('a', T0);
    expect(s.lockedForSeconds('a', T0)).toBe(15 * 60);
  });

  it('still locked at 14:59, unlocked at 15:00', () => {
    fail('a', 5);
    expect(s.lockedForSeconds('a', T0 + 15 * MIN - 1000)).toBe(1);
    expect(s.lockedForSeconds('a', T0 + 15 * MIN)).toBe(0);
  });

  it('the lock counts from the 5th failure and attempts while locked do not extend it', () => {
    fail('a', 4, T0);
    s.recordFailure('a', T0 + 5 * MIN);
    s.recordFailure('a', T0 + 10 * MIN);
    expect(s.lockedForSeconds('a', T0 + 20 * MIN - 1000)).toBe(1);
    expect(s.lockedForSeconds('a', T0 + 20 * MIN)).toBe(0);
  });

  it('after a lock expires the count starts again from zero', () => {
    fail('a', 5);
    const later = T0 + 15 * MIN;
    fail('a', 4, later);
    expect(s.lockedForSeconds('a', later)).toBe(0);
    s.recordFailure('a', later);
    expect(s.lockedForSeconds('a', later)).toBe(15 * 60);
  });

  it('a success clears the counter', () => {
    fail('a', 4);
    s.clear('a');
    fail('a', 4);
    expect(s.lockedForSeconds('a', T0)).toBe(0);
    // and a lock
    s.recordFailure('a', T0);
    expect(s.lockedForSeconds('a', T0)).toBeGreaterThan(0);
    s.clear('a');
    expect(s.lockedForSeconds('a', T0)).toBe(0);
  });

  it('failures older than the window do not count', () => {
    fail('a', 4, T0);
    const later = T0 + LOGIN_FAILURE_WINDOW_MS + 1;
    s.recordFailure('a', later);
    expect(s.lockedForSeconds('a', later)).toBe(0);
    // failures spread inside the window do count
    fail('b', 2, T0);
    fail('b', 2, T0 + 7 * MIN);
    s.recordFailure('b', T0 + 14 * MIN);
    expect(s.lockedForSeconds('b', T0 + 14 * MIN)).toBe(15 * 60);
  });

  it('two identifiers are independent', () => {
    fail('a', 5);
    expect(s.lockedForSeconds('a', T0)).toBeGreaterThan(0);
    expect(s.lockedForSeconds('b', T0)).toBe(0);
    fail('b', 4);
    expect(s.lockedForSeconds('b', T0)).toBe(0);
  });

  it('prunes an entry once its failures and lock have expired', () => {
    fail('a', 2);
    expect(s.size).toBe(1);
    expect(s.lockedForSeconds('a', T0 + LOGIN_FAILURE_WINDOW_MS)).toBe(0);
    expect(s.size).toBe(0);
  });

  it('the store is capped at 10 000 keys and drops the oldest', () => {
    for (let i = 0; i < LOGIN_ATTEMPTS_MAX_KEYS; i++) {
      s.recordFailure(`k${i}`, T0);
    }
    expect(s.size).toBe(LOGIN_ATTEMPTS_MAX_KEYS);
    s.recordFailure('new', T0);
    expect(s.size).toBe(LOGIN_ATTEMPTS_MAX_KEYS);
    // k0 was dropped: 4 more failures do not lock it
    fail('k0', 4);
    expect(s.lockedForSeconds('k0', T0)).toBe(0);
    // k2 kept its failure: 4 more lock it
    fail('k2', 4);
    expect(s.lockedForSeconds('k2', T0)).toBeGreaterThan(0);
  });

  it('at the cap, expired entries go first and a locked one is kept over an unlocked one', () => {
    fail('locked', 5, T0);
    for (let i = 1; i < LOGIN_ATTEMPTS_MAX_KEYS; i++) {
      s.recordFailure(`k${i}`, T0 + MIN);
    }
    expect(s.size).toBe(LOGIN_ATTEMPTS_MAX_KEYS);
    s.recordFailure('new', T0 + 2 * MIN);
    expect(s.size).toBe(LOGIN_ATTEMPTS_MAX_KEYS);
    expect(s.lockedForSeconds('locked', T0 + 2 * MIN)).toBeGreaterThan(0);
    // all the k* failures expired: the next new key sweeps them all
    const later = T0 + MIN + LOGIN_FAILURE_WINDOW_MS + 1;
    s.recordFailure('newer', later);
    expect(s.size).toBe(2); // 'new' (failure at T0+2min) and 'newer'
  });

  it('assertNotLocked throws a 429 with the minutes left, logging no key', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      fail('secret-key', 5, Date.now());
      let thrown: unknown;
      try {
        s.assertNotLocked('secret-key');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LoginLockedException);
      const ex = thrown as LoginLockedException;
      expect(ex.getStatus()).toBe(429);
      expect(ex.retryAfterSeconds).toBeGreaterThan(14 * 60);
      expect(ex.getResponse()).toEqual({
        statusCode: 429,
        message:
          'Too many failed attempts for this account. Try again in 15 minutes.',
      });
      expect(warn).toHaveBeenCalledWith('login lockout');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-key');
      expect(() => s.assertNotLocked('other')).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it('the message rounds minutes up, at least 1', () => {
    expect(lockoutMessage(1)).toBe(
      'Too many failed attempts for this account. Try again in 1 minute.',
    );
    expect(lockoutMessage(61)).toContain('in 2 minutes.');
    expect(lockoutMessage(900)).toContain('in 15 minutes.');
    expect(lockoutMessage(0)).toContain('in 1 minute.');
  });
});
