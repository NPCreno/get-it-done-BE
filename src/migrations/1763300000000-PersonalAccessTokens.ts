import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Personal access tokens for the MCP endpoint (FEAT-07a). Only adds a table.
 * The secret part is stored as sha256 hex; the 10-character prefix is the
 * public lookup key. Cascades with the user. Hand-written like the other
 * migrations; names match PersonalAccessTokenEntity.
 */
export class PersonalAccessTokens1763300000000 implements MigrationInterface {
  name = 'PersonalAccessTokens1763300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "personal_access_tokens" (
      "id" uuid NOT NULL,
      "user_id" varchar NOT NULL,
      "name" varchar(60) NOT NULL,
      "prefix" varchar(16) NOT NULL,
      "secret_hash" char(64) NOT NULL,
      "scopes" varchar(100) NOT NULL DEFAULT 'mcp',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "last_used_at" timestamptz NULL,
      "expires_at" timestamptz NULL,
      "revoked_at" timestamptz NULL,
      CONSTRAINT "PK_pat" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_pat_prefix" UNIQUE ("prefix"),
      CONSTRAINT "FK_pat_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_pat_user" ON "personal_access_tokens" ("user_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "personal_access_tokens"`);
  }
}
