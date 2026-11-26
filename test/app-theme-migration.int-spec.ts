/**
 * RD-1a AppTheme migration on production's shape (every migration through
 * PomodoroStyle): the schema the current entities describe minus
 * users."appTheme", with the earlier migrations recorded as run. Exactly one
 * migration runs, a second run does nothing, synchronize finds no drift, no
 * row gets a value, and up -> down -> up works. Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';
import { AppTheme1763800000000 } from '../src/migrations/1763800000000-AppTheme';

const DB = 'getitdone_test_app_theme_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'AppTheme1763800000000';

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

describe('AppTheme migration (RD-1a)', () => {
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
        WHERE table_name = 'users' AND column_name = 'appTheme'`,
    );
  const withAppTheme = async () =>
    Number(
      (
        await ds.query(
          `SELECT count(*)::int AS n FROM users WHERE "appTheme" IS NOT NULL`,
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
    // Production today: no appTheme column.
    await ds.query('ALTER TABLE "users" DROP COLUMN "appTheme"');
    await ds.query(`CREATE TABLE "migrations" (
      "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
    for (const M of migrations.filter((m) => new m().name !== NAME)) {
      const name = new M().name as string;
      await ds.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
        [name.match(/(\d{13})$/)![1], name],
      );
    }
    // Existing users: one light, one dark, one never chose.
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier, theme)
      VALUES ('U', 'U', 'u', 'u@example.com', 'x', 'free', 'light'),
             ('V', 'V', 'v', 'v@example.com', 'x', 'free', 'dark'),
             ('W', 'W', 'w', 'w@example.com', 'x', 'free', NULL)`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('AM1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(new migrations[migrations.length - 1]().name).toBe(NAME);
    expect(await drift()).not.toEqual([]);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('AM2 nullable varchar, no default; no data change (rehearsal check)', async () => {
    await ds.runMigrations();
    expect(await columns()).toEqual([
      {
        column_name: 'appTheme',
        data_type: 'character varying',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(await withAppTheme()).toBe(0);
    expect(
      await ds.query(`SELECT user_id, theme FROM users ORDER BY user_id`),
    ).toEqual([
      { user_id: 'U', theme: 'light' },
      { user_id: 'V', theme: 'dark' },
      { user_id: 'W', theme: null },
    ]);
  });

  it('AM3 up -> down -> up; down drops only the column', async () => {
    await ds.runMigrations();
    await ds.query(`UPDATE users SET "appTheme" = 'calm' WHERE user_id = 'U'`);
    await ds.undoLastMigration();
    expect(await columns()).toEqual([]);
    expect((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(
      3,
    );
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
    expect((await columns()).length).toBe(1);
    expect(await withAppTheme()).toBe(0);
    expect(await drift()).toEqual([]);
  });

  it('AM4 up() twice is safe and keeps a value', async () => {
    await ds.runMigrations();
    await ds.query(`UPDATE users SET "appTheme" = 'field' WHERE user_id = 'V'`);
    const runner = ds.createQueryRunner();
    try {
      await new AppTheme1763800000000().up(runner);
    } finally {
      await runner.release();
    }
    expect(
      (await ds.query(`SELECT "appTheme" FROM users WHERE user_id = 'V'`))[0]
        .appTheme,
    ).toBe('field');
  });
});
