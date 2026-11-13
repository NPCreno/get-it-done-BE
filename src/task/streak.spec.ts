import { computeStreak } from './streak';

const midnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const set = (...d: string[]) => new Set(d);

/** The pre-extraction loop from TaskService.getStreakCount, kept as the oracle. */
function legacyCount(dates: Set<string>, hasToday: boolean, today: Date) {
  let streak = 0;
  const cur = new Date(today);
  cur.setDate(cur.getDate() - 1);
  while (streak < 730) {
    if (!dates.has(cur.toISOString().split('T')[0])) break;
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return hasToday ? streak + 1 : streak;
}

describe('computeStreak', () => {
  it('U3 same day twice gives an identical result', () => {
    const d = set('2026-03-10');
    const a = computeStreak(d, true, midnight('2026-03-10'));
    const b = computeStreak(d, true, midnight('2026-03-10'));
    expect(a).toEqual({ count: 1, start: '2026-03-10' });
    expect(b).toEqual(a);
  });

  it('U4 a continuing run keeps the same start', () => {
    const day2 = computeStreak(
      set('2026-03-10', '2026-03-11'),
      true,
      midnight('2026-03-11'),
    );
    const day3 = computeStreak(
      set('2026-03-10', '2026-03-11', '2026-03-12'),
      true,
      midnight('2026-03-12'),
    );
    expect(day2).toEqual({ count: 2, start: '2026-03-10' });
    expect(day3).toEqual({ count: 3, start: '2026-03-10' });
  });

  it('U5 a gap starts a new run at count 1 with a new start', () => {
    const run = set('2026-03-01', '2026-03-02', '2026-03-03', '2026-03-10');
    const r = computeStreak(run, true, midnight('2026-03-10'));
    expect(r).toEqual({ count: 1, start: '2026-03-10' });
  });

  it('U6 month and year boundaries', () => {
    expect(
      computeStreak(
        set('2026-01-30', '2026-01-31', '2026-02-01'),
        true,
        midnight('2026-02-01'),
      ),
    ).toEqual({ count: 3, start: '2026-01-30' });
    expect(
      computeStreak(
        set('2025-12-31', '2026-01-01'),
        true,
        midnight('2026-01-01'),
      ),
    ).toEqual({ count: 2, start: '2025-12-31' });
  });

  it('U7 past midnight without a completion today keeps the start', () => {
    const d = set('2026-03-10');
    const sameDay = computeStreak(d, true, midnight('2026-03-10'));
    const nextDay = computeStreak(d, false, midnight('2026-03-11'));
    expect(nextDay.start).toBe(sameDay.start);
    expect(nextDay.count).toBe(1);
  });

  it('no completions: count 0, no start', () => {
    expect(computeStreak(set(), false, midnight('2026-03-10'))).toEqual({
      count: 0,
      start: null,
    });
  });

  it('U8 count matches the pre-extraction loop on fixture sets', () => {
    const today = midnight('2026-03-15');
    const fixtures: [Set<string>, boolean][] = [
      [set(), false],
      [set(), true],
      [set('2026-03-14', '2026-03-13', '2026-03-12'), false],
      [set('2026-03-14', '2026-03-13', '2026-03-10'), true],
      [set('2026-03-13', '2026-03-12'), true],
    ];
    for (const [dates, hasToday] of fixtures) {
      expect(computeStreak(dates, hasToday, today).count).toBe(
        legacyCount(dates, hasToday, today),
      );
    }
  });
});
