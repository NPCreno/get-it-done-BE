import { MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';
import { withHeartbeatAndExpiry } from './notification-stream';
import { decodeCursor, encodeCursor } from './notification-cursor';

describe('notification stream (N8)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('emits a ping every 25 s and passes live events through', () => {
    const live = new Subject<MessageEvent>();
    const got: MessageEvent[] = [];
    const sub = withHeartbeatAndExpiry(live).subscribe((e) => got.push(e));
    jest.advanceTimersByTime(25_000);
    expect(got.map((e) => e.type)).toEqual(['ping']);
    live.next({ type: 'notification', data: 'x' });
    jest.advanceTimersByTime(25_000);
    expect(got.map((e) => e.type)).toEqual(['ping', 'notification', 'ping']);
    sub.unsubscribe();
  });

  it('completes at the expiry time', () => {
    const live = new Subject<MessageEvent>();
    let done = false;
    withHeartbeatAndExpiry(live, {
      expiresAtMs: 10_000,
      now: () => 0,
    }).subscribe({ complete: () => (done = true) });
    jest.advanceTimersByTime(9_999);
    expect(done).toBe(false);
    jest.advanceTimersByTime(2);
    expect(done).toBe(true);
  });
});

describe('notification cursor', () => {
  it('round-trips and rejects junk', () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    for (const bad of ['', '!!!', 'e30', encodeCursor(-1), encodeCursor(1.5)]) {
      expect(() => decodeCursor(bad)).toThrow();
    }
  });
});
