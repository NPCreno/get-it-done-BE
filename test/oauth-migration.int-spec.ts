/**
 * FEAT-07c OAuth migration on production's shape (every migration through
 * TemplateAndTokenForeignKeys): the schema the current entities describe
 * minus the four OAuth tables, with those migrations recorded as run. Exactly
 * one migration runs, a second run does nothing, synchronize finds no drift,
 * the constraints and cascades work, and down() drops only the OAuth tables.
 * Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';

const DB = 'getitdone_test_oauth_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'OAuth1763500000000';
const TABLES = ['oauth_clients', 'oauth_grants', 'oauth_codes', 'oauth_tokens'];

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

describe('OAuth migration (FEAT-07c)', () => {
  let ds: DataSource;
  const all = allMigrations();
  const migrations = all.slice(
    0,
    all.findIndex((M) => new M().name === NAME) + 1,
  );
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
    // Production today: no OAuth tables, every earlier migration recorded.
    await ds.query(
      `DROP TABLE ${TABLES.slice()
        .reverse()
        .map((t) => `"${t}"`)
        .join(', ')}`,
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
    await ds.query(`INSERT INTO users (fullname, user_id, username, email, password, tier)
      VALUES ('U', 'U', 'u', 'u@example.com', 'x', 'free'),
             ('V', 'V', 'v', 'v@example.com', 'x', 'free')`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('OM1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(new migrations[migrations.length - 1]().name).toBe(NAME);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    for (const t of TABLES) expect(await exists(t)).toBe(true);
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('OM2 constraint names, unique keys and cascades', async () => {
    await ds.runMigrations();
    expect(
      (
        await ds.query(
          `SELECT conname, contype, confdeltype FROM pg_constraint
            WHERE conrelid::regclass::text = ANY($1) ORDER BY conname`,
          [TABLES],
        )
      ).map((r: { conname: string; contype: string; confdeltype: string }) =>
        [r.conname, r.contype, r.confdeltype.trim()].join(':'),
      ),
    ).toEqual([
      'FK_oauth_codes_grant:f:c',
      'FK_oauth_grants_client:f:c',
      'FK_oauth_grants_user:f:c',
      'FK_oauth_tokens_grant:f:c',
      'PK_oauth_clients:p:',
      'PK_oauth_codes:p:',
      'PK_oauth_grants:p:',
      'PK_oauth_tokens:p:',
      'UQ_oauth_clients_client_id:u:',
      'UQ_oauth_tokens_prefix:u:',
    ]);
    expect(
      (
        await ds.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = ANY($1)
             AND indexname LIKE 'IDX_%' ORDER BY 1`,
          [TABLES],
        )
      ).map((r: { indexname: string }) => r.indexname),
    ).toEqual([
      'IDX_oauth_codes_grant',
      'IDX_oauth_grants_client',
      'IDX_oauth_grants_user',
      'IDX_oauth_tokens_grant',
    ]);
    const C = '00000000-0000-4000-8000-0000000000c1';
    const G = '00000000-0000-4000-8000-0000000000a1';
    await ds.query(
      `INSERT INTO oauth_clients (id, client_id, client_name, redirect_uris)
       VALUES ($1, 'gid_cli_x', 'n', ARRAY['https://a.example/cb'])`,
      [C],
    );
    await expect(
      ds.query(
        `INSERT INTO oauth_clients (id, client_id, client_name, redirect_uris)
         VALUES (gen_random_uuid(), 'gid_cli_x', 'n', ARRAY['https://a.example/cb'])`,
      ),
    ).rejects.toThrow(/duplicate key/);
    await ds.query(
      `INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, expires_at)
       VALUES ($1, 'U', $2, ARRAY['mcp'], 'https://a/mcp', now() + interval '1 day')`,
      [G, C],
    );
    await expect(
      ds.query(
        `INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, expires_at)
         VALUES (gen_random_uuid(), 'NOPE', $1, ARRAY['mcp'], 'r', now())`,
        [C],
      ),
    ).rejects.toThrow(/foreign key/);
    await ds.query(
      `INSERT INTO oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
       VALUES (repeat('a', 64), $1, 'https://a.example/cb', 'c', now())`,
      [G],
    );
    await ds.query(
      `INSERT INTO oauth_tokens (id, grant_id, kind, prefix, secret_hash, expires_at)
       VALUES (gen_random_uuid(), $1, 'access', 'AAAAAAAAAA', repeat('b', 64), now())`,
      [G],
    );
    await expect(
      ds.query(
        `INSERT INTO oauth_tokens (id, grant_id, kind, prefix, secret_hash, expires_at)
         VALUES (gen_random_uuid(), $1, 'refresh', 'AAAAAAAAAA', repeat('c', 64), now())`,
        [G],
      ),
    ).rejects.toThrow(/duplicate key/);
    // deleting the user cascades through the grant to codes and tokens
    await ds.query(`DELETE FROM users WHERE user_id = 'U'`);
    for (const t of ['oauth_grants', 'oauth_codes', 'oauth_tokens'])
      expect((await ds.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n).toBe(
        0,
      );
    expect(
      (await ds.query(`SELECT count(*)::int AS n FROM oauth_clients`))[0].n,
    ).toBe(1);
  });

  it('OM3 up -> down -> up; down drops only the OAuth tables', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    for (const t of TABLES) expect(await exists(t)).toBe(false);
    expect(await exists('personal_access_tokens')).toBe(true);
    expect((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(
      2,
    );
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
  });
});
