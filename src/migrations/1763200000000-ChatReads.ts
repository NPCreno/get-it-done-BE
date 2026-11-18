import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat unread counts (FEAT-08a). chat_reads holds each user's read point per
 * project: the created_at of the newest message they marked read. It never
 * moves back (the service upserts with GREATEST). Cascades with the project and
 * the user; ChatMembersService.remove deletes a removed member's row. Only adds
 * a table. Hand-written like the other migrations; names match
 * ChatReadEntity.
 */
export class ChatReads1763200000000 implements MigrationInterface {
  name = 'ChatReads1763200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "chat_reads" (
      "project_id" varchar NOT NULL,
      "user_id" varchar NOT NULL,
      "last_read_at" timestamptz(3) NOT NULL,
      CONSTRAINT "PK_chat_reads" PRIMARY KEY ("project_id", "user_id"),
      CONSTRAINT "FK_chat_reads_project" FOREIGN KEY ("project_id")
        REFERENCES "project_entity"("project_id") ON DELETE CASCADE,
      CONSTRAINT "FK_chat_reads_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("user_id") ON DELETE CASCADE)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "chat_reads"`);
  }
}
