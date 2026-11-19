/**
 * FEAT-07a PersonalAccessTokens migration on production's shape (the six
 * migrations through ChatReads): the schema the current entities describe
 * minus personal_access_tokens, with those six recorded as run. Exactly one
 * migration runs, a second run does nothing, and synchronize finds no drift.
 * Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';

const DB = 'getitdone_test_pat_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'PersonalAccessTokens1763300000000';

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

describe('PersonalAccessTokens migration (FEAT-07a)', () => {
  let ds: DataSource;
  const migrations = allMigrations();
  const exists = async (table: string) =>
    (
      await ds.query(`SELECT to_regclass($1)::text AS t`, [`public.${table}`])
    )[0].t !== null;
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);

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
    // Production today: no personal_access_tokens, six migrations recorded.
    await ds.query('DROP TABLE "personal_access_tokens"');
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
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('PM1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(migrations).toHaveLength(7);
    expect(new migrations[6]().name).toBe(NAME);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    expect(await exists('personal_access_tokens')).toBe(true);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('PM2 columns, defaults, unique prefix, index and cascade', async () => {
    await ds.runMigrations();
    expect(
      await ds.query(
        `SELECT column_name, data_type, is_nullable,
                character_maximum_length AS len, column_default AS def
           FROM information_schema.columns
          WHERE table_name = 'personal_access_tokens' ORDER BY ordinal_position`,
      ),
    ).toEqual([
      {
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        len: null,
        def: null,
      },
      {
        column_name: 'user_id',
        data_type: 'character varying',
        is_nullable: 'NO',
        len: null,
        def: null,
      },
      {
        column_name: 'name',
        data_type: 'character varying',
        is_nullable: 'NO',
        len: 60,
        def: null,
      },
      {
        column_name: 'prefix',
        data_type: 'character varying',
        is_nullable: 'NO',
        len: 16,
        def: null,
      },
      {
        column_name: 'secret_hash',
        data_type: 'character',
        is_nullable: 'NO',
        len: 64,
        def: null,
      },
      {
        column_name: 'scopes',
        data_type: 'character varying',
        is_nullable: 'NO',
        len: 100,
        def: "'mcp'::character varying",
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        len: null,
        def: 'now()',
      },
      {
        column_name: 'last_used_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        len: null,
        def: null,
      },
      {
        column_name: 'expires_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        len: null,
        def: null,
      },
      {
        column_name: 'revoked_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        len: null,
        def: null,
      },
    ]);
    expect(
      await ds.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'personal_access_tokens' ORDER BY 1`,
      ),
    ).toEqual([
      { indexname: 'IDX_pat_user' },
      { indexname: 'PK_pat' },
      { indexname: 'UQ_pat_prefix' },
    ]);
    const insert = (id: string, user: string, prefix: string) =>
      ds.query(
        `INSERT INTO personal_access_tokens (id, user_id, name, prefix, secret_hash)
         VALUES ($1, $2, 'n', $3, repeat('a', 64))`,
        [id, user, prefix],
      );
    await insert('00000000-0000-4000-8000-000000000001', 'U', 'AAAAAAAAAA');
    await insert('00000000-0000-4000-8000-000000000002', 'V', 'BBBBBBBBBB');
    await expect(
      insert('00000000-0000-4000-8000-000000000003', 'V', 'AAAAAAAAAA'),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      insert('00000000-0000-4000-8000-000000000004', 'NOPE', 'CCCCCCCCCC'),
    ).rejects.toThrow(/foreign key/);
    await ds.query(`DELETE FROM users WHERE user_id = 'U'`);
    expect(
      await ds.query('SELECT user_id, scopes FROM personal_access_tokens'),
    ).toEqual([{ user_id: 'V', scopes: 'mcp' }]);
  });

  it('PM3 up -> down -> up; down drops only personal_access_tokens', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(await exists('personal_access_tokens')).toBe(false);
    expect(await exists('chat_reads')).toBe(true);
    expect((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(
      2,
    );
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
  });
});
