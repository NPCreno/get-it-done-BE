/**
 * FEAT-08a ChatReads migration on production's shape after ProjectChat: the
 * schema the current entities describe minus chat_reads, with the first five
 * migrations recorded as run. Exactly one migration runs, a second run does
 * nothing, and synchronize finds no drift. Uses its own DB. Later migrations
 * (PersonalAccessTokens, FEAT-07a) are left out and their tables dropped, so
 * the database is exactly production after ProjectChat.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';

const DB = 'getitdone_test_chat_reads_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');

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

describe('ChatReads migration (FEAT-08a)', () => {
  let ds: DataSource;
  const all = allMigrations();
  const migrations = all.slice(
    0,
    all.findIndex((M) => new M().name === 'ChatReads1763200000000') + 1,
  );
  /** Tables of migrations after ChatReads, which this suite leaves out. */
  const LATER = /personal_access_tokens/;
  const exists = async (table: string) =>
    (
      await ds.query(`SELECT to_regclass($1)::text AS t`, [`public.${table}`])
    )[0].t !== null;
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries
      .map((q) => q.query)
      .filter((q) => !LATER.test(q));

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
    // Production after ProjectChat: no chat_reads, five migrations recorded.
    await ds.query('DROP TABLE "chat_reads", "personal_access_tokens"');
    await ds.query(`CREATE TABLE "migrations" (
      "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
    for (const M of migrations.slice(0, -1)) {
      const name = new M().name as string;
      await ds.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
        [name.match(/(\d{13})$/)![1], name],
      );
    }
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier)
      VALUES ('O', 'O', 'o', 'o@example.com', 'x', 'free'),
             ('M', 'M', 'm', 'm@example.com', 'x', 'free')`);
    await ds.query(`INSERT INTO project_entity (project_id, user_id, title)
      VALUES ('P1', 'O', 'one'), ('P2', 'O', 'two')`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('CR1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(migrations.map((M) => new M().name).slice(-2)).toEqual([
      'ProjectChat1763100000000',
      'ChatReads1763200000000',
    ]);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual(['ChatReads1763200000000']);
    expect(await exists('chat_reads')).toBe(true);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('CR2 columns, key, foreign keys and cascades', async () => {
    await ds.runMigrations();
    expect(
      await ds.query(
        `SELECT column_name, data_type, is_nullable, datetime_precision AS prec
           FROM information_schema.columns
          WHERE table_name = 'chat_reads' ORDER BY ordinal_position`,
      ),
    ).toEqual([
      {
        column_name: 'project_id',
        data_type: 'character varying',
        is_nullable: 'NO',
        prec: null,
      },
      {
        column_name: 'user_id',
        data_type: 'character varying',
        is_nullable: 'NO',
        prec: null,
      },
      {
        column_name: 'last_read_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        prec: 3,
      },
    ]);
    const insert = (p: string, u: string) =>
      ds.query(
        `INSERT INTO chat_reads (project_id, user_id, last_read_at) VALUES ($1, $2, now())`,
        [p, u],
      );
    await insert('P1', 'M');
    await insert('P2', 'M');
    await insert('P2', 'O');
    await expect(insert('P1', 'M')).rejects.toThrow(/duplicate key/);
    await expect(insert('NOPE', 'M')).rejects.toThrow(/foreign key/);
    await expect(insert('P1', 'NOPE')).rejects.toThrow(/foreign key/);

    await ds.query(`DELETE FROM project_entity WHERE project_id = 'P1'`);
    await ds.query(`DELETE FROM users WHERE user_id = 'M'`);
    expect(
      await ds.query('SELECT project_id, user_id FROM chat_reads'),
    ).toEqual([{ project_id: 'P2', user_id: 'O' }]);
  });

  it('CR3 up -> down -> up; down drops only chat_reads', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(await exists('chat_reads')).toBe(false);
    expect(await exists('chat_messages')).toBe(true);
    expect(await exists('project_members')).toBe(true);
    expect(
      (await ds.query('SELECT count(*)::int AS n FROM project_entity'))[0].n,
    ).toBe(2);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([
      'ChatReads1763200000000',
    ]);
  });
});
