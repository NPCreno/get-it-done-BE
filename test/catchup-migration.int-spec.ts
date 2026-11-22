/**
 * OPS-04 CatchUpBaseline: production never ran a migration and has no
 * `notifications`. Every migration in src/migrations must run in one go on
 * production's shape, the catch-up must be a no-op where the table exists, and
 * a second run must do nothing. Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';
import { CatchUpBaseline1762700000000 } from '../src/migrations/1762700000000-CatchUpBaseline';

const DB = 'getitdone_test_catchup';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');

/** Every migration class in src/migrations, oldest first (like the CLI glob). */
function allMigrations(): (new () => MigrationInterface)[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .sort()
    .map((f) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(MIGRATIONS_DIR, f)) as Record<string, unknown>;
      return Object.values(mod).find(
        (v) => typeof v === 'function',
      ) as new () => MigrationInterface;
    });
}

const withMigrations = (migrations: (new () => MigrationInterface)[]) =>
  new DataSource({
    type: 'postgres',
    url: URL,
    entities: ENTITIES,
    migrations,
    migrationsTransactionMode: 'all',
  });

/** The schema synchronize builds from the current entities. */
async function synchronizeSchema(): Promise<void> {
  const ds = new DataSource({
    type: 'postgres',
    url: URL,
    entities: ENTITIES,
    synchronize: true,
  });
  await ds.initialize();
  await ds.destroy();
}

/**
 * Production as found on 2026-11-17: the synchronize schema from before
 * DATA-01, the award ledger and chat. No notifications (unless kept), no chat tables, no
 * user_awards, no lifetime count, no token rotation columns or index; task
 * `id` is uuid. Seeds one user with two completed tasks and a token row.
 */
async function seedProductionShape(
  ds: DataSource,
  keepNotifications: boolean,
): Promise<void> {
  await ds.query('DROP TABLE "user_awards"');
  // FEAT-05 chat tables postdate production (migrations ProjectChat, ChatReads).
  await ds.query('DROP TABLE "chat_reads", "chat_messages", "project_members"');
  // FEAT-07a personal_access_tokens postdates production (PersonalAccessTokens).
  await ds.query('DROP TABLE "personal_access_tokens"');
  // FEAT-07c OAuth tables postdate production (OAuth).
  await ds.query(
    'DROP TABLE "oauth_tokens", "oauth_codes", "oauth_grants", "oauth_clients"',
  );
  // REF-14c: production has no foreign keys on templates and token rows.
  await ds.query(`ALTER TABLE "task_template_entity"
    DROP CONSTRAINT "FK_task_template_user",
    DROP CONSTRAINT "FK_task_template_project"`);
  await ds.query(
    'ALTER TABLE "auth_token_entity" DROP CONSTRAINT "FK_auth_token_user"',
  );
  // FEAT-09a task assignee postdates production (SharedTasks).
  await ds.query(
    'ALTER TABLE "task_instance_entity" DROP COLUMN "assignee_id"',
  );
  if (!keepNotifications) {
    await ds.query('DROP TABLE "notifications"');
    await ds.query(
      'DROP TYPE "notifications_type_enum", "notifications_actiontype_enum"',
    );
  }
  await ds.query('ALTER TABLE "users" DROP COLUMN "lifetime_completed_count"');
  await ds.query(`ALTER TABLE "auth_token_entity"
    DROP COLUMN "remember_me", DROP COLUMN "revoked_at",
    DROP COLUMN "replaced_by_token_id", DROP COLUMN "replay_ciphertext"`);
  await ds.query('DROP INDEX "IDX_c9e89f7dc8c617e892461f88a0"');

  await ds.query(`INSERT INTO "users" (fullname, user_id, username, email, password, tier)
    VALUES ('Prod User', 'user-1', 'prod', 'prod@example.com', '$2b$12$abcdefghijklmnopqrstuuJ8h0rW0x9V5mQm0r6YhC2jY6f1yS3W.', 'free')`);
  for (const t of ['task-1', 'task-2'])
    await ds.query(
      `INSERT INTO "task_instance_entity" (task_id, user_id, title, priority, status)
       VALUES ($1, 'user-1', 'done', 'Low', 'Complete')`,
      [t],
    );
  await ds.query(`INSERT INTO "auth_token_entity"
      (token_id, user_id, token, expires_at, "createdAt", is_revoked, family_id)
    VALUES ('tok-1', 'user-1', 'hash', now() + interval '7 days', now(), false, 'fam-1')`);
}

describe('CatchUpBaseline migration', () => {
  let ds: DataSource;
  let log: jest.SpyInstance;
  const printed = () => log.mock.calls.map((c) => c.join(' ')).join('\n');
  const exists = async (table: string) =>
    (
      await ds.query(`SELECT to_regclass($1)::text AS t`, [`public.${table}`])
    )[0].t !== null;
  const columns = async (table: string) =>
    (
      await ds.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table],
      )
    ).map((r: { column_name: string }) => r.column_name);
  /** What synchronize would still run, i.e. drift left after the migrations. */
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);

  beforeEach(async () => {
    await resetDatabase(BASE_URL, DB);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    log.mockRestore();
    if (ds?.isInitialized) await ds.destroy();
  });

  it('C1 production shape: every migration runs in one go', async () => {
    await synchronizeSchema();
    const migrations = allMigrations();
    ds = withMigrations(migrations);
    await ds.initialize();
    await seedProductionShape(ds, false);
    expect(await exists('notifications')).toBe(false);

    const ran = await ds.runMigrations();

    expect(ran.map((m) => m.name)).toEqual(migrations.map((M) => new M().name));
    expect(ran[0].name).toBe('CatchUpBaseline1762700000000');
    expect(printed()).toContain('[CatchUpBaseline] created notifications');
    expect(await exists('notifications')).toBe(true);
    expect(await exists('user_awards')).toBe(true);
    expect(await columns('users')).toContain('lifetime_completed_count');
    expect(await columns('auth_token_entity')).toEqual(
      expect.arrayContaining([
        'remember_me',
        'revoked_at',
        'replaced_by_token_id',
        'replay_ciphertext',
      ]),
    );
    expect(
      await ds.query(`SELECT count(*)::int AS n FROM "migrations"`),
    ).toEqual([{ n: migrations.length }]);
    expect(
      await ds.query(
        `SELECT lifetime_completed_count AS c FROM "users" WHERE user_id = 'user-1'`,
      ),
    ).toEqual([{ c: 2 }]);
    expect(
      await ds.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name = 'task_instance_entity' AND column_name = 'id'`,
      ),
    ).toEqual([{ data_type: 'uuid' }]);

    // The catch-up DDL is exactly synchronize's, and task id needs no change.
    const left = await drift();
    expect(left.filter((q) => /notifications/.test(q))).toEqual([]);
    expect(left.filter((q) => /task_instance_entity/.test(q))).toEqual([]);
    // ProjectChat creates exactly what the chat entities describe.
    expect(await exists('project_members')).toBe(true);
    expect(await exists('chat_messages')).toBe(true);
    expect(left.filter((q) => /project_members|chat_messages/.test(q))).toEqual(
      [],
    );
    // ChatReads (FEAT-08a) likewise.
    expect(await exists('chat_reads')).toBe(true);
    expect(left.filter((q) => /chat_reads/.test(q))).toEqual([]);
    // PersonalAccessTokens (FEAT-07a) likewise.
    expect(await exists('personal_access_tokens')).toBe(true);
    expect(left.filter((q) => /personal_access_tokens/.test(q))).toEqual([]);
    // TemplateAndTokenForeignKeys (REF-14c): the three foreign keys, exactly
    // as the entities describe them.
    expect(
      await ds.query(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE conname IN ('FK_task_template_user', 'FK_task_template_project',
                            'FK_auth_token_user') ORDER BY conname`,
      ),
    ).toEqual([
      { conname: 'FK_auth_token_user', confdeltype: 'c' },
      { conname: 'FK_task_template_project', confdeltype: 'c' },
      { conname: 'FK_task_template_user', confdeltype: 'c' },
    ]);
    expect(
      left.filter((q) => /task_template_entity|FK_auth_token_user/.test(q)),
    ).toEqual([]);
    // OAuth (FEAT-07c): the four tables exactly as the entities describe them.
    for (const t of [
      'oauth_clients',
      'oauth_grants',
      'oauth_codes',
      'oauth_tokens',
    ])
      expect(await exists(t)).toBe(true);
    expect(left.filter((q) => /oauth_/.test(q))).toEqual([]);
    // SharedTasks (FEAT-09a): the assignee column and FK as the entity says,
    // and 'assignment' added to the enum CatchUpBaseline created.
    expect(await columns('task_instance_entity')).toContain('assignee_id');
    expect(
      (
        await ds.query(
          `SELECT unnest(enum_range(NULL::notifications_type_enum))::text AS v`,
        )
      ).map((r: { v: string }) => r.v),
    ).toContain('assignment');
  });

  it('C2 notifications already there: catch-up is a no-op and the rest run', async () => {
    await synchronizeSchema();
    const migrations = allMigrations();
    ds = withMigrations(migrations);
    await ds.initialize();
    await seedProductionShape(ds, true);
    await ds.query(`INSERT INTO "notifications" (notif_id, user_id, type, title, read)
      VALUES ('notif-1', 'user-1', 'achievement', 'First Task Completed!', false)`);

    const ran = await ds.runMigrations();

    expect(ran).toHaveLength(migrations.length);
    expect(printed()).toContain(
      '[CatchUpBaseline] notifications already exists; no change',
    );
    expect(await ds.query(`SELECT notif_id FROM "notifications"`)).toEqual([
      { notif_id: 'notif-1' },
    ]);
    expect(
      await ds.query(
        `SELECT award_key FROM "user_awards" WHERE user_id = 'user-1'`,
      ),
    ).toEqual([{ award_key: 'achievement:eq:1' }]);
  });

  it('C2b a database built by synchronize: the catch-up changes nothing', async () => {
    await synchronizeSchema();
    ds = withMigrations([CatchUpBaseline1762700000000]);
    await ds.initialize();
    expect(await drift()).toEqual([]);

    await ds.runMigrations();

    expect(printed()).toContain('notifications already exists; no change');
    expect(await drift()).toEqual([]);
  });

  it('C3 a second migration:run does nothing', async () => {
    await synchronizeSchema();
    ds = withMigrations(allMigrations());
    await ds.initialize();
    await seedProductionShape(ds, false);
    await ds.runMigrations();
    const before = await ds.query(`SELECT name FROM "migrations" ORDER BY id`);

    expect(await ds.showMigrations()).toBe(false);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await ds.query(`SELECT name FROM "migrations" ORDER BY id`)).toEqual(
      before,
    );
  });

  it('C4 down() is a documented no-op that keeps the table', async () => {
    await synchronizeSchema();
    ds = withMigrations([CatchUpBaseline1762700000000]);
    await ds.initialize();
    await ds.query('DROP TABLE "notifications"');
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(await exists('notifications')).toBe(true);
  });
});
