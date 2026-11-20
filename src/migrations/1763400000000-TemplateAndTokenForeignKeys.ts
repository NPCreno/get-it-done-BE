import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * REF-14c: the three foreign keys production never had. Templates and refresh
 * token rows go with their user, and templates with their project (their
 * instances' template link becomes null through the existing SET NULL).
 * Soft deletes keep the rows, so nothing changes for them.
 *
 * Plain ADD CONSTRAINT validates every row. If an orphan exists, it fails, the
 * whole migration batch rolls back and the deploy fails (the previous build
 * keeps serving): the intended safety net. Orphans were counted as 0 on the
 * Neon rehearsal branch before this shipped. Names match the entities.
 */
export class TemplateAndTokenForeignKeys1763400000000
  implements MigrationInterface
{
  name = 'TemplateAndTokenForeignKeys1763400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "task_template_entity"
      ADD CONSTRAINT "FK_task_template_user" FOREIGN KEY ("user_id")
      REFERENCES "users"("user_id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "task_template_entity"
      ADD CONSTRAINT "FK_task_template_project" FOREIGN KEY ("project_id")
      REFERENCES "project_entity"("project_id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "auth_token_entity"
      ADD CONSTRAINT "FK_auth_token_user" FOREIGN KEY ("user_id")
      REFERENCES "users"("user_id") ON DELETE CASCADE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "auth_token_entity" DROP CONSTRAINT IF EXISTS "FK_auth_token_user"`,
    );
    await q.query(
      `ALTER TABLE "task_template_entity" DROP CONSTRAINT IF EXISTS "FK_task_template_project"`,
    );
    await q.query(
      `ALTER TABLE "task_template_entity" DROP CONSTRAINT IF EXISTS "FK_task_template_user"`,
    );
  }
}
