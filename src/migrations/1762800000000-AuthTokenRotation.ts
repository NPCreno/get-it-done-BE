import { MigrationInterface, QueryRunner } from 'typeorm';

/** Hand-written: prod has never run migrations, so no generated drift. */
export class AuthTokenRotation1762800000000 implements MigrationInterface {
  name = 'AuthTokenRotation1762800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "auth_token_entity"
      ADD COLUMN "remember_me" boolean NOT NULL DEFAULT false,
      ADD COLUMN "revoked_at" timestamptz NULL,
      ADD COLUMN "replaced_by_token_id" varchar NULL,
      ADD COLUMN "replay_ciphertext" text NULL`);
    // Keep the lifetime class of existing sessions: 7d rows had Remember Me.
    await q.query(`UPDATE "auth_token_entity"
      SET "remember_me" = ("expires_at" - "createdAt") > interval '2 days'`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_token_entity_user_id" ON "auth_token_entity" ("user_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_auth_token_entity_user_id"`);
    await q.query(`ALTER TABLE "auth_token_entity"
      DROP COLUMN "replay_ciphertext",
      DROP COLUMN "replaced_by_token_id",
      DROP COLUMN "revoked_at",
      DROP COLUMN "remember_me"`);
  }
}
