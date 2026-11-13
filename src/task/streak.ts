export interface StreakInfo {
  /** Consecutive days with a completion, ending today or yesterday. */
  count: number;
  /** Date string (YYYY-MM-DD, same basis as `completedDates`) of the run's first day; null when count is 0. */
  start: string | null;
}

/** Existing basis, kept on purpose: local midnight shifted by whole days, read as a UTC date string. */
const dateKey = (d: Date) => d.toISOString().split('T')[0];

/**
 * Pure streak walk extracted from `TaskService.getStreakCount` (same output).
 * Counts back from yesterday while each date is in `completedDates`, plus one
 * when something was completed today. `start` identifies the streak run, so it
 * is stable for the whole run and changes only after a break.
 */
export function computeStreak(
  completedDates: Set<string>,
  hasCompletedToday: boolean,
  todayLocalMidnight: Date,
): StreakInfo {
  let streak = 0;
  const currentDate = new Date(todayLocalMidnight);
  currentDate.setDate(currentDate.getDate() - 1); // start from yesterday

  while (streak < 730) {
    // 2 years max
    if (!completedDates.has(dateKey(currentDate))) break;
    streak++;
    currentDate.setDate(currentDate.getDate() - 1);
  }

  const count = hasCompletedToday ? streak + 1 : streak;
  if (count === 0) return { count: 0, start: null };

  // The run starts `streak` days before today whether or not today is done:
  // today-done: today - streak; yesterday-ended: (today - 1) - (streak - 1).
  const start = new Date(todayLocalMidnight);
  start.setDate(start.getDate() - streak);
  return { count, start: dateKey(start) };
}
