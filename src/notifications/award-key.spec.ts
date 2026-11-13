import { awardKeyFor } from './award-key';

const none = { streakStart: null };

describe('awardKeyFor', () => {
  const eq1 = { type: 'achievement', condition: { equals: 1 } } as const;
  const every10 = { type: 'milestone', condition: { every: 10 } } as const;

  it('U1 equals: match gives the key, mismatch null, type prefix kept', () => {
    expect(awardKeyFor(eq1, 1, none)).toBe('achievement:eq:1');
    expect(awardKeyFor(eq1, 2, none)).toBeNull();
    expect(
      awardKeyFor({ type: 'levelUp', condition: { equals: 1 } }, 1, none),
    ).toBe('levelUp:eq:1');
    expect(
      awardKeyFor({ type: 'reward', condition: { equals: 20 } }, 20, none),
    ).toBe('reward:eq:20');
  });

  it('U2 every 10: multiples only, never 0 or negative', () => {
    expect(awardKeyFor(every10, 0, none)).toBeNull();
    expect(awardKeyFor(every10, 10, none)).toBe('milestone:every:10:10');
    expect(awardKeyFor(every10, 20, none)).toBe('milestone:every:10:20');
    expect(awardKeyFor(every10, 30, none)).toBe('milestone:every:10:30');
    expect(awardKeyFor(every10, 15, none)).toBeNull();
    expect(awardKeyFor(every10, -10, none)).toBeNull();
  });

  it('streak equals is keyed by the run start; no key without a run', () => {
    const rule = { type: 'streak', condition: { equals: 3 } } as const;
    expect(awardKeyFor(rule, 3, { streakStart: '2026-01-30' })).toBe(
      'streak:eq:3:2026-01-30',
    );
    expect(awardKeyFor(rule, 3, none)).toBeNull();
    expect(awardKeyFor(rule, 2, { streakStart: '2026-01-30' })).toBeNull();
  });

  it('a dead rule (equals 0) never matches', () => {
    expect(
      awardKeyFor({ type: 'taskDue', condition: { equals: 0 } }, 0, none),
    ).toBeNull();
  });
});
