/**
 * FEAT-10a PomodoroStyle migration on production's shape (every migration
 * through SharedTasks): the schema the current entities describe minus
 * users."pomodoroStyle" and users."identityChangedAt", with the earlier
 * migrations recorded as run. Exactly one migration runs, a second run does
 * nothing, synchronize finds no drift, identityChangedAt is backfilled from
 * updatedAt, and down -> up works. Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';
import { PomodoroStyle1763700000000 } from '../src/migrations/1763700000000-PomodoroStyle';

const DB = 'getitdone_test_pomodoro_style_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'PomodoroStyle1763700000000';

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

describe('PomodoroStyle migration (FEAT-10a)', () => {
  let ds: DataSource;
  const all = allMigrations();
  const migrations = all.slice(
    0,
    all.findIndex((M) => new M().name === NAME) + 1,
  );
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);
  const columns = async () =>
    await ds.query<Record<string, string | null>[]>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name IN ('pomodoroStyle', 'identityChangedAt')
        ORDER BY column_name`,
    );
  const mismatched = async () =>
    Number(
      (
        await ds.query(
          `SELECT count(*)::int AS n FROM users WHERE "identityChangedAt" <> "updatedAt"`,
        )
      )[0].n,
    );

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
    // Production today: neither column.
    await ds.query(
      'ALTER TABLE "users" DROP COLUMN "pomodoroStyle", DROP COLUMN "identityChangedAt"',
    );
    await ds.query(`CREATE TABLE "migrations" (
      "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
    for (const M of migrations.filter((m) => new m().name !== NAME)) {
      const name = new M().name as string;
      await ds.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
        [name.match(/(\d{13})$/)![1], name],
      );
    }
    // Two existing users with different, old updatedAt values.
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier, "updatedAt")
      VALUES ('U', 'U', 'u', 'u@example.com', 'x', 'free', now() - interval '2 months'),
             ('V', 'V', 'v', 'v@example.com', 'x', 'free', now() - interval '3 years')`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('PM1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(new migrations[migrations.length - 1]().name).toBe(NAME);
    expect(await drift()).not.toEqual([]);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('PM2 columns: nullable varchar style, NOT NULL timestamp default now()', async () => {
    await ds.runMigrations();
    expect(await columns()).toEqual([
      {
        column_name: 'identityChangedAt',
        data_type: 'timestamp without time zone',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'pomodoroStyle',
        data_type: 'character varying',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    // Rehearsal checks (RELEASES): no style set, every lock unchanged.
    expect(
      (
        await ds.query(
          `SELECT count(*)::int AS n FROM users WHERE "pomodoroStyle" IS NOT NULL`,
        )
      )[0].n,
    ).toBe(0);
    expect(await mismatched()).toBe(0);
  });

  it('PM3 backfill: identityChangedAt equals updatedAt for existing rows; a new row gets now()', async () => {
    await ds.runMigrations();
    const rows = await ds.query<{ user_id: string; same: boolean }[]>(
      `SELECT user_id, "identityChangedAt" = "updatedAt" AS same FROM users ORDER BY user_id`,
    );
    expect(rows).toEqual([
      { user_id: 'U', same: true },
      { user_id: 'V', same: true },
    ]);
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier)
      VALUES ('W', 'W', 'w', 'w@example.com', 'x', 'free')`);
    const fresh = (
      await ds.query(
        `SELECT now() - "identityChangedAt" < interval '1 minute' AS recent FROM users WHERE user_id = 'W'`,
      )
    )[0].recent;
    expect(fresh).toBe(true);
  });

  it('PM4 up -> down -> up; down drops only the two columns', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(await columns()).toEqual([]);
    expect((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(
      2,
    );
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
    expect((await columns()).length).toBe(2);
    expect(await mismatched()).toBe(0);
  });

  it('PM5 up() twice is safe and never resets a real identityChangedAt', async () => {
    await ds.runMigrations();
    await ds.query(
      `UPDATE users SET "identityChangedAt" = now(), "pomodoroStyle" = 'ticket' WHERE user_id = 'V'`,
    );
    const runner = ds.createQueryRunner();
    try {
      await new PomodoroStyle1763700000000().up(runner);
    } finally {
      await runner.release();
    }
    expect(await mismatched()).toBe(1);
    expect(
      (
        await ds.query(`SELECT "pomodoroStyle" FROM users WHERE user_id = 'V'`)
      )[0].pomodoroStyle,
    ).toBe('ticket');
  });
});
