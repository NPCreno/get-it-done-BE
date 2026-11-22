import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FEAT-09a shared tasks. Project members work on the project's tasks, and a
 * task can be assigned to the owner or a member:
 * - `task_instance_entity.assignee_id` (nullable, FK to users.user_id, SET
 *   NULL when that user is deleted). `user_id` stays the creator.
 * - `idx_task_responsible` on `COALESCE(assignee_id, user_id)`: every "my
 *   tasks" query filters on exactly this expression.
 * - `idx_task_assignee`, partial, for the FK's SET NULL and assignee lookups.
 * - `'assignment'` in `notifications_type_enum` (the name CatchUpBaseline
 *   creates; checked on the Neon rehearsal branch).
 *
 * Postgres 12+ allows ALTER TYPE ... ADD VALUE inside the migration
 * transaction as long as the same transaction does not use the value, so no
 * `assignment` row is written here. `IF NOT EXISTS` everywhere: a no-op on a
 * database built by synchronize. Names match TaskInstanceEntity.
 */
export class SharedTasks1763600000000 implements MigrationInterface {
  name = 'SharedTasks1763600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "task_instance_entity"
      ADD COLUMN IF NOT EXISTS "assignee_id" character varying NULL
      CONSTRAINT "FK_task_assignee" REFERENCES "users"("user_id") ON DELETE SET NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_task_assignee"
      ON "task_instance_entity" ("assignee_id") WHERE "assignee_id" IS NOT NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_task_responsible"
      ON "task_instance_entity" ((COALESCE("assignee_id", "user_id")))`);
    await q.query(
      `ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'assignment'`,
    );
  }

  /**
   * Drops the column and indexes. Postgres cannot remove an enum value, so
   * `'assignment'` stays in notifications_type_enum (harmless: nothing else
   * reads it); `assignment` notification rows stay too.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_task_responsible"`);
    await q.query(`DROP INDEX IF EXISTS "idx_task_assignee"`);
    await q.query(
      `ALTER TABLE "task_instance_entity" DROP COLUMN IF EXISTS "assignee_id"`,
    );
  }
}
