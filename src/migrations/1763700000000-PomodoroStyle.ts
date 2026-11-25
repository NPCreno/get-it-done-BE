import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FEAT-10a. Two columns on users:
 * - "pomodoroStyle": the Pomodoro timer style, a nullable varchar like theme
 *   and soundFx. null = never chosen (the FE shows dial). No CHECK constraint:
 *   UpdateUserDto (@IsIn API_CONTRACT.pomodoroStyles) is the boundary, same as
 *   theme. No backfill.
 * - "identityChangedAt": the last name, username or password change, which the
 *   six-month rule reads instead of updatedAt (every preference save moves
 *   updatedAt). Backfilled from updatedAt, so nobody's lock moves on release
 *   day; new accounts get now(), like before.
 * IF NOT EXISTS / IF EXISTS, so a synchronize-built database is a no-op (the
 * backfill runs only when up() adds identityChangedAt). Hand-written like the other migrations; names match UserEntity.
 */
export class PomodoroStyle1763700000000 implements MigrationInterface {
  name = 'PomodoroStyle1763700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pomodoroStyle" character varying NULL`,
    );
    // Backfill only when this run adds the column, so a second up() (or a
    // synchronize-built database) never resets a real identityChangedAt.
    const had = (await q.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users'
          AND column_name = 'identityChangedAt'`,
    )) as unknown[];
    if (had.length > 0) return;
    await q.query(
      `ALTER TABLE "users" ADD COLUMN "identityChangedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await q.query(`UPDATE "users" SET "identityChangedAt" = "updatedAt"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "identityChangedAt"`,
    );
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pomodoroStyle"`);
  }
}
