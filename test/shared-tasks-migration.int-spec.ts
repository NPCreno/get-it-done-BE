/**
 * FEAT-09a SharedTasks migration on production's shape (every migration
 * through OAuth): the schema the current entities describe minus
 * `task_instance_entity.assignee_id`, and `notifications_type_enum` without
 * 'assignment', with the earlier migrations recorded as run. Exactly one
 * migration runs, a second run does nothing, synchronize finds no drift, the
 * FK sets null, both indexes exist, and down() keeps the enum value.
 * Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';

const DB = 'getitdone_test_shared_tasks_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'SharedTasks1763600000000';
const OLD_TYPES = [
  'achievement',
  'milestone',
  'streak',
  'levelUp',
  'reward',
  'taskDue',
];

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

describe('SharedTasks migration (FEAT-09a)', () => {
  let ds: DataSource;
  const all = allMigrations();
  const migrations = all.slice(
    0,
    all.findIndex((M) => new M().name === NAME) + 1,
  );
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);
  const enumValues = async () =>
    (
      await ds.query(
        `SELECT unnest(enum_range(NULL::notifications_type_enum))::text AS v`,
      )
    ).map((r: { v: string }) => r.v);
  const indexes = async () =>
    (
      await ds.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'task_instance_entity' AND indexname LIKE 'idx_task_%'
          ORDER BY 1`,
      )
    ).map((r: { indexname: string; indexdef: string }) => [
      r.indexname,
      r.indexdef,
    ]);

  beforeEach(async () => {
    await resetDatabase(BASE_URL, DB);
    const sync = new DataSource({
      type: 'postgres',
      url: URL,
      entities: ENTITIES,
      synchronize: true,
    });
    await sync.initialize();
    await sync.destroy();

    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: ENTITIES,
      migrations,
      migrationsTransactionMode: 'all',
    });
    await ds.initialize();
    // Production today: no assignee column, the six old notification types.
    await ds.query(
      'ALTER TABLE "task_instance_entity" DROP COLUMN "assignee_id"',
    );
    await ds.query(`ALTER TYPE "notifications_type_enum" RENAME TO "nte_old"`);
    await ds.query(
      `CREATE TYPE "notifications_type_enum" AS ENUM (${OLD_TYPES.map((v) => `'${v}'`).join(', ')})`,
    );
    await ds.query(`ALTER TABLE "notifications" ALTER COLUMN "type"
      TYPE "notifications_type_enum" USING "type"::text::"notifications_type_enum"`);
    await ds.query(`DROP TYPE "nte_old"`);
    await ds.query(`CREATE TABLE "migrations" (
      "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
    for (const M of migrations.filter((m) => new m().name !== NAME)) {
      const name = new M().name as string;
      await ds.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
        [name.match(/(\d{13})$/)![1], name],
      );
    }
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier)
      VALUES ('U', 'U', 'u', 'u@example.com', 'x', 'free'),
             ('V', 'V', 'v', 'v@example.com', 'x', 'free')`);
    await ds.query(`INSERT INTO task_instance_entity (task_id, user_id, title, priority, status)
      VALUES ('t1', 'U', 'kept', 'Low', 'Pending')`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('SM1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(new migrations[migrations.length - 1]().name).toBe(NAME);
    expect(await drift()).not.toEqual([]);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
    expect(await enumValues()).toEqual([...OLD_TYPES, 'assignment']);
    expect(
      await ds.query(`SELECT task_id, assignee_id FROM task_instance_entity`),
    ).toEqual([{ task_id: 't1', assignee_id: null }]);
  });

  it('SM2 indexes, FK SET NULL and the new enum value work', async () => {
    await ds.runMigrations();
    expect(await indexes()).toEqual([
      [
        'idx_task_assignee',
        expect.stringMatching(
          /\(assignee_id\) WHERE \(assignee_id IS NOT NULL\)$/,
        ),
      ],
      [
        'idx_task_responsible',
        expect.stringMatching(/\(COALESCE\(assignee_id, user_id\)\)$/),
      ],
    ]);
    expect(
      await ds.query(
        `SELECT conname, confdeltype FROM pg_constraint WHERE conname = 'FK_task_assignee'`,
      ),
    ).toEqual([{ conname: 'FK_task_assignee', confdeltype: 'n' }]);
    await ds.query(`UPDATE task_instance_entity SET assignee_id = 'V'`);
    await expect(
      ds.query(`UPDATE task_instance_entity SET assignee_id = 'NOPE'`),
    ).rejects.toThrow(/foreign key/);
    await ds.query(`INSERT INTO notifications (notif_id, user_id, type, title, read)
      VALUES ('n1', 'V', 'assignment', 'New task assigned', false)`);
    await ds.query(`DELETE FROM users WHERE user_id = 'V'`);
    expect(
      await ds.query(`SELECT assignee_id FROM task_instance_entity`),
    ).toEqual([{ assignee_id: null }]);
  });

  it('SM3 up -> down -> up; down keeps the enum value and the tasks', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(
      await ds.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'task_instance_entity' AND column_name = 'assignee_id'`,
      ),
    ).toEqual([]);
    expect(await indexes()).toEqual([]);
    expect(await enumValues()).toContain('assignment');
    expect(
      (await ds.query('SELECT count(*)::int AS n FROM task_instance_entity'))[0]
        .n,
    ).toBe(1);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
    expect(await drift()).toEqual([]);
  });
});
