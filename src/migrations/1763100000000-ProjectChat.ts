import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project chat (FEAT-05).
 * 1. project_members: users a project's owner shared it with. The owner is
 *    never a row here (ownership stays project_entity.user_id).
 * 2. chat_messages: soft-deleted messages, paged by
 *    (project_id, created_at DESC, id). Ids come from the application.
 * Both cascade when the project or the user is deleted. Hand-written like the
 * other migrations; runs inside the shared transaction. Names match the
 * entities' constraint names.
 */
export class ProjectChat1763100000000 implements MigrationInterface {
  name = 'ProjectChat1763100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "project_members" (
      "project_id" varchar NOT NULL,
      "user_id" varchar NOT NULL,
      "added_by" varchar NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_project_members" PRIMARY KEY ("project_id", "user_id"),
      CONSTRAINT "FK_project_members_project" FOREIGN KEY ("project_id")
        REFERENCES "project_entity"("project_id") ON DELETE CASCADE,
      CONSTRAINT "FK_project_members_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_project_members_user" ON "project_members" ("user_id")`,
    );

    await q.query(`CREATE TABLE "chat_messages" (
      "id" uuid NOT NULL,
      "project_id" varchar NOT NULL,
      "user_id" varchar NOT NULL,
      "body" varchar(2000) NOT NULL,
      "created_at" timestamptz(3) NOT NULL DEFAULT now(),
      "deleted_at" timestamptz(3),
      CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
      CONSTRAINT "FK_chat_messages_project" FOREIGN KEY ("project_id")
        REFERENCES "project_entity"("project_id") ON DELETE CASCADE,
      CONSTRAINT "FK_chat_messages_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE)`);
    await q.query(
      `CREATE INDEX "IDX_chat_messages_project_created_id" ON "chat_messages" ("project_id", "created_at" DESC, "id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_chat_messages_user" ON "chat_messages" ("user_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await q.query(`DROP TABLE IF EXISTS "project_members"`);
  }
}
