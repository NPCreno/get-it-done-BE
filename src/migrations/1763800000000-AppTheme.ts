import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RD-1a. users."appTheme": the theme family (classic, calm, field), a
 * nullable varchar like theme, soundFx and pomodoroStyle. null = classic, so
 * no backfill: every existing user stays Classic with their current light or
 * dark. users.theme stays the mode and gains 'system' in API_CONTRACT only
 * (it is a plain varchar, so no schema change).
 *
 * No CHECK constraint: UpdateUserDto (@IsIn API_CONTRACT.appThemes) is the
 * boundary, the same as for theme and pomodoroStyle, and adding a theme later
 * then needs no migration. IF NOT EXISTS / IF EXISTS, so a
 * synchronize-built database is a no-op. Hand-written like the other
 * migrations; the name matches UserEntity.
 */
export class AppTheme1763800000000 implements MigrationInterface {
  name = 'AppTheme1763800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appTheme" character varying NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "appTheme"`);
  }
}
