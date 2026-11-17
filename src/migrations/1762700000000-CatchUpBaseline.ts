import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OPS-04: production never ran a migration, and its schema came from
 * synchronize before `notifications` existed. No later migration creates that
 * table, yet AwardOnce reads it. This creates it with exactly the DDL
 * synchronize uses for NotificationsEntity (names included, so `schema:log`
 * shows no drift afterwards). Its timestamp is older than every other
 * migration, so it runs first.
 *
 * A no-op on any database that already has the table (local and test
 * databases built by synchronize). Hand-written like the other migrations.
 */
const ENUMS: Record<string, string[]> = {
  notifications_type_enum: [
    'achievement',
    'milestone',
    'streak',
    'levelUp',
    'reward',
    'taskDue',
  ],
  notifications_actiontype_enum: ['acknowledge', 'complete', 'claim'],
};

export class CatchUpBaseline1762700000000 implements MigrationInterface {
  name = 'CatchUpBaseline1762700000000';

  public async up(q: QueryRunner): Promise<void> {
    const [{ t }]: { t: string | null }[] = await q.query(
      `SELECT to_regclass('public.notifications')::text AS t`,
    );
    if (t) {
      console.log('[CatchUpBaseline] notifications already exists; no change');
      return;
    }

    for (const [name, values] of Object.entries(ENUMS)) {
      const list = values.map((v) => `'${v}'`).join(', ');
      await q.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typname = '${name}') THEN
          CREATE TYPE "public"."${name}" AS ENUM(${list});
        END IF;
      END $$`);
    }

    await q.query(`CREATE TABLE IF NOT EXISTS "notifications" (
      "id" SERIAL NOT NULL,
      "notif_id" character varying NOT NULL,
      "type" "public"."notifications_type_enum" NOT NULL,
      "title" character varying NOT NULL,
      "message" character varying,
      "read" boolean NOT NULL,
      "actionType" "public"."notifications_actiontype_enum",
      "actionTarget" character varying,
      "metadata" text,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      "user_id" character varying,
      CONSTRAINT "UQ_7a5ca2b2ac8d7a28e7ecd975e0c" UNIQUE ("notif_id"),
      CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"),
      CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    const indexes: [string, string][] = [
      ['IDX_7a5ca2b2ac8d7a28e7ecd975e0', 'notif_id'],
      ['IDX_9a8a82462cab47c73d25f49261', 'user_id'],
      ['IDX_f8b7ed75170d2d7dca4477cc94', 'read'],
      ['IDX_831a5a06f879fb0bebf8965871', 'createdAt'],
    ];
    for (const [index, column] of indexes) {
      await q.query(
        `CREATE INDEX IF NOT EXISTS "${index}" ON "notifications" ("${column}")`,
      );
    }
    console.log('[CatchUpBaseline] created notifications (empty)');
  }

  /**
   * Does nothing on purpose: the table predates the migration history on
   * every database that has one, and dropping it would delete notifications.
   */
  public async down(): Promise<void> {}
}
