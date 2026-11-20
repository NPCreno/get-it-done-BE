import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OAuth for MCP connectors (FEAT-07c). Only adds four tables; names match the
 * entities in src/oauth/models. Secrets, codes and tokens are stored as
 * sha256 hex only. Everything cascades from the user (grants) and the client
 * (grants), and from the grant (codes, tokens).
 */
export class OAuth1763500000000 implements MigrationInterface {
  name = 'OAuth1763500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "oauth_clients" (
      "id" uuid NOT NULL,
      "client_id" varchar(64) NOT NULL,
      "client_name" varchar(100) NOT NULL,
      "redirect_uris" text[] NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "last_used_at" timestamptz NULL,
      CONSTRAINT "PK_oauth_clients" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_oauth_clients_client_id" UNIQUE ("client_id"))`);
    await q.query(`CREATE TABLE "oauth_grants" (
      "id" uuid NOT NULL,
      "user_id" varchar NOT NULL,
      "client_id" uuid NOT NULL,
      "scopes" text[] NOT NULL,
      "resource" varchar NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "last_used_at" timestamptz NULL,
      "expires_at" timestamptz NOT NULL,
      "revoked_at" timestamptz NULL,
      CONSTRAINT "PK_oauth_grants" PRIMARY KEY ("id"),
      CONSTRAINT "FK_oauth_grants_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE,
      CONSTRAINT "FK_oauth_grants_client" FOREIGN KEY ("client_id")
        REFERENCES "oauth_clients"("id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_oauth_grants_user" ON "oauth_grants" ("user_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_oauth_grants_client" ON "oauth_grants" ("client_id")`,
    );
    await q.query(`CREATE TABLE "oauth_codes" (
      "code_hash" char(64) NOT NULL,
      "grant_id" uuid NOT NULL,
      "redirect_uri" varchar NOT NULL,
      "code_challenge" varchar(128) NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "used_at" timestamptz NULL,
      CONSTRAINT "PK_oauth_codes" PRIMARY KEY ("code_hash"),
      CONSTRAINT "FK_oauth_codes_grant" FOREIGN KEY ("grant_id")
        REFERENCES "oauth_grants"("id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_oauth_codes_grant" ON "oauth_codes" ("grant_id")`,
    );
    await q.query(`CREATE TABLE "oauth_tokens" (
      "id" uuid NOT NULL,
      "grant_id" uuid NOT NULL,
      "kind" varchar(10) NOT NULL,
      "prefix" varchar(16) NOT NULL,
      "secret_hash" char(64) NOT NULL,
      "pair_id" uuid NULL,
      "expires_at" timestamptz NOT NULL,
      "revoked_at" timestamptz NULL,
      "rotated_at" timestamptz NULL,
      "replaced_by" uuid NULL,
      "used_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_oauth_tokens" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_oauth_tokens_prefix" UNIQUE ("prefix"),
      CONSTRAINT "FK_oauth_tokens_grant" FOREIGN KEY ("grant_id")
        REFERENCES "oauth_grants"("id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_oauth_tokens_grant" ON "oauth_tokens" ("grant_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "oauth_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "oauth_codes"`);
    await q.query(`DROP TABLE IF EXISTS "oauth_grants"`);
    await q.query(`DROP TABLE IF EXISTS "oauth_clients"`);
  }
}
