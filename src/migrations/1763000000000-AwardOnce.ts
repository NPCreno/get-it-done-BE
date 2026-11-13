import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Award each achievement once.
 * 1. users.lifetime_completed_count: cumulative completions, backfilled from
 *    the current non-deleted Complete tasks (reverted history is unrecoverable).
 * 2. user_awards: ledger of awards given, primary key (user_id, award_key).
 * 3. Backfill the ledger from surviving notification rows with an exact
 *    (type, title) map frozen below, so existing users are not re-awarded.
 *    Rows that map to nothing are reported, never guessed.
 * Hand-written like the other migrations; runs inside the shared transaction.
 */

/** Frozen copy of notification.rules.json at the time of this migration. */
const AWARD_MAP: Record<string, string> = {
  'achievement|First Task Completed!': 'achievement:eq:1',
  'achievement|Half Century!': 'achievement:eq:50',
  'achievement|Task Master': 'achievement:eq:100',
  'achievement|Quarter K!': 'achievement:eq:250',
  'achievement|500 Tasks!': 'achievement:eq:500',
  'achievement|Productivity Legend': 'achievement:eq:1000',
  'levelUp|Level Up!': 'levelUp:eq:1',
  'levelUp|Level 5 Unlocked!': 'levelUp:eq:5',
  'levelUp|Century!': 'levelUp:eq:100',
  'reward|Surprise Reward 🎁': 'reward:eq:20',
};
const MILESTONE_TITLE = 'Milestone Achieved!';
const MILESTONE_EVERY = 10;
/** Types that become awards. Streak and taskDue rows are intentionally not backfilled. */
const AWARD_TYPES = ['achievement', 'levelUp', 'reward', 'milestone'];

interface NotifRow {
  id: number;
  user_id: string;
  type: string;
  title: string;
  metadata: string | null;
}

/** Key for a notification row, or the reason it has none. */
function classify(row: NotifRow): { key: string } | { reason: string } {
  if (row.type === 'milestone') {
    if (row.title !== MILESTONE_TITLE) return { reason: 'unknown title' };
    let raw: unknown;
    try {
      raw = row.metadata ? JSON.parse(row.metadata)?.completedCount : undefined;
    } catch {
      return { reason: 'invalid completedCount' };
    }
    const text = typeof raw === 'number' ? String(raw) : raw;
    if (typeof text !== 'string' || !/^[0-9]+$/.test(text))
      return { reason: 'invalid completedCount' };
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n <= 0)
      return { reason: 'invalid completedCount' };
    if (n % MILESTONE_EVERY !== 0)
      return { reason: `completedCount not a multiple of ${MILESTONE_EVERY}` };
    return { key: `milestone:every:${MILESTONE_EVERY}:${n}` };
  }
  const key = AWARD_MAP[`${row.type}|${row.title}`];
  if (key) return { key };
  const otherType = Object.keys(AWARD_MAP).some((k) =>
    k.endsWith(`|${row.title}`),
  );
  return {
    reason: otherType ? 'title mapped under a different type' : 'unknown title',
  };
}

export class AwardOnce1763000000000 implements MigrationInterface {
  name = 'AwardOnce1763000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" ADD COLUMN "lifetime_completed_count" integer NOT NULL DEFAULT 0`,
    );
    await q.query(`UPDATE "users" u SET "lifetime_completed_count" = (
      SELECT count(*) FROM "task_instance_entity" t
       WHERE t."user_id" = u."user_id" AND t."status" = 'Complete' AND t."deletedAt" IS NULL)`);

    await q.query(`CREATE TABLE "user_awards" (
      "user_id" varchar NOT NULL REFERENCES "users"("user_id") ON DELETE CASCADE,
      "award_key" varchar(100) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("user_id", "award_key"))`);

    const rows: NotifRow[] = await q.query(
      `SELECT "id", "user_id", "type"::text AS "type", "title", "metadata"::text AS "metadata"
         FROM "notifications" WHERE "type"::text = ANY($1) ORDER BY "id"`,
      [AWARD_TYPES],
    );

    const userIds: string[] = [];
    const keys: string[] = [];
    const unmapped = new Map<string, number>();
    for (const row of rows) {
      const c = classify(row);
      if ('key' in c) {
        userIds.push(row.user_id);
        keys.push(c.key);
      } else {
        const k = JSON.stringify([row.type, row.title, c.reason]);
        unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
      }
    }

    let inserted = 0;
    if (keys.length > 0) {
      const res: unknown = await q.query(
        `INSERT INTO "user_awards" ("user_id", "award_key")
         SELECT v.u, v.k FROM unnest($1::varchar[], $2::varchar[]) WITH ORDINALITY AS v(u, k, o)
           JOIN "users" us ON us."user_id" = v.u
          ORDER BY v.o
         ON CONFLICT DO NOTHING
         RETURNING "award_key"`,
        [userIds, keys],
      );
      inserted = Array.isArray(res) ? res.length : 0;
    }

    const unmappedTotal = [...unmapped.values()].reduce((a, b) => a + b, 0);
    console.log(
      `[AwardOnce] backfilled ${inserted} award(s) from ${rows.length} notification row(s); ${unmappedTotal} unmapped row(s)`,
    );
    for (const [k, count] of unmapped) {
      const [type, title, reason] = JSON.parse(k) as string[];
      console.log(
        `[AwardOnce] unmapped type=${type} title=${JSON.stringify(title)} reason=${reason} count=${count}`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "user_awards"`);
    await q.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "lifetime_completed_count"`,
    );
  }
}
