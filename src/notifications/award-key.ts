import { NotificationRule } from './models/notification.interfaces';

export interface AwardContext {
  /** First day of the current streak run (see `computeStreak`); null when there is none. */
  streakStart: string | null;
}

/**
 * Identity of an award, or null when the rule does not match `value`.
 * - `equals: n` on the lifetime count: once ever (`type:eq:n`)
 * - `every: n` on the lifetime count: once per multiple (`type:every:n:value`)
 * - `equals: n` on the streak: once per streak run (`streak:eq:n:start`)
 * `value` is the metric for the rule type: the streak count for `streak` rules,
 * the lifetime completed count otherwise.
 */
export function awardKeyFor(
  rule: Pick<NotificationRule, 'type' | 'condition'>,
  value: number,
  ctx: AwardContext,
): string | null {
  const { every, equals } = rule.condition;

  if (every) {
    if (value > 0 && value % every === 0)
      return `${rule.type}:every:${every}:${value}`;
    return null;
  }

  if (equals && value === equals) {
    if (rule.type === 'streak') {
      if (value <= 0 || !ctx.streakStart) return null;
      return `streak:eq:${equals}:${ctx.streakStart}`;
    }
    return `${rule.type}:eq:${equals}`;
  }
  return null;
}
