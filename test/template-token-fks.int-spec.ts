/**
 * REF-14c TemplateAndTokenForeignKeys on production's shape (the seven
 * migrations through PersonalAccessTokens): the schema the current entities
 * describe minus the three foreign keys, with those seven recorded as run.
 * Exactly one migration runs, a second run does nothing, synchronize finds no
 * drift, an orphan makes the batch fail and roll back, and the cascades work
 * at database level. Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, MigrationInterface } from 'typeorm';
import { resetDatabase } from './int-db';

const DB = 'getitdone_test_fk_migration';
const URL = `${BASE_URL}/${DB}`;
const ENTITIES = [join(__dirname, '../src/**/*.entity.ts')];
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');
const NAME = 'TemplateAndTokenForeignKeys1763400000000';
const FKS = [
  'FK_auth_token_user',
  'FK_task_template_project',
  'FK_task_template_user',
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

describe('TemplateAndTokenForeignKeys migration (REF-14c)', () => {
  let ds: DataSource;
  const all = allMigrations();
  const migrations = all.slice(
    0,
    all.findIndex((M) => new M().name === NAME) + 1,
  );
  const drift = async () =>
    (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);
  const fks = async () =>
    (
      await ds.query(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE conname = ANY($1) ORDER BY conname`,
        [FKS],
      )
    ).map((r: { conname: string; confdeltype: string }) => r);
  const count = async (sql: string) => (await ds.query(sql))[0].n as number;

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
    // Production today: no foreign keys on templates and token rows.
    await ds.query(`ALTER TABLE "task_template_entity"
      DROP CONSTRAINT "FK_task_template_user",
      DROP CONSTRAINT "FK_task_template_project"`);
    await ds.query(
      'ALTER TABLE "auth_token_entity" DROP CONSTRAINT "FK_auth_token_user"',
    );
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
      VALUES ('U', 'U', 'u', 'u@example.com', 'x', 'free'),
             ('V', 'V', 'v', 'v@example.com', 'x', 'free')`);
    await ds.query(`INSERT INTO project_entity (project_id, user_id, title)
      VALUES ('P1', 'U', 'one'), ('P2', 'V', 'two')`);
    await ds.query(`INSERT INTO task_template_entity
        (user_id, project_id, "taskTemplate_id", title, repeat_every, start_date)
      VALUES ('U', 'P1', 'TMP-U-P1', 'a', 'Day', now()),
             ('U', NULL, 'TMP-U', 'b', 'Day', now()),
             ('V', 'P2', 'TMP-V-P2', 'c', 'Day', now())`);
    await ds.query(`INSERT INTO auth_token_entity
        (token_id, user_id, token, expires_at, is_revoked, family_id)
      VALUES ('tok-U', 'U', 'h', now() + interval '1 day', false, 'fam-U'),
             ('tok-V', 'V', 'h', now() + interval '1 day', false, 'fam-V')`);
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('FK1 exactly one migration runs; a second run does nothing; no drift', async () => {
    expect(migrations.map((M) => new M().name).slice(-2)).toEqual([
      'PersonalAccessTokens1763300000000',
      NAME,
    ]);
    expect(await fks()).toEqual([]);
    const ran = await ds.runMigrations();
    expect(ran.map((m) => m.name)).toEqual([NAME]);
    expect(await fks()).toEqual(
      FKS.map((conname) => ({ conname, confdeltype: 'c' })),
    );
    expect(await ds.runMigrations()).toEqual([]);
    expect(await drift()).toEqual([]);
  });

  it('FK2 an orphan fails the batch and rolls everything back', async () => {
    await ds.query(`INSERT INTO auth_token_entity
        (token_id, user_id, token, expires_at, is_revoked, family_id)
      VALUES ('tok-X', 'GONE', 'h', now() + interval '1 day', false, 'fam-X')`);
    await expect(ds.runMigrations()).rejects.toThrow(/foreign key/);
    expect(await fks()).toEqual([]);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM migrations WHERE name = '${NAME}'`,
      ),
    ).toBe(0);
  });

  it('FK3 hard-deleting a user removes their templates and refresh-token rows', async () => {
    await ds.runMigrations();
    await ds.query(`DELETE FROM users WHERE user_id = 'U'`);
    expect(
      await ds.query(
        `SELECT "taskTemplate_id" AS id FROM task_template_entity ORDER BY 1`,
      ),
    ).toEqual([{ id: 'TMP-V-P2' }]);
    expect(
      await ds.query(`SELECT token_id FROM auth_token_entity ORDER BY 1`),
    ).toEqual([{ token_id: 'tok-V' }]);
  });

  it('FK4 hard-deleting a project removes its templates; their instances lose the link', async () => {
    await ds.runMigrations();
    const [{ id: templatePk }] = await ds.query(
      `SELECT id FROM task_template_entity WHERE "taskTemplate_id" = 'TMP-U-P1'`,
    );
    await ds.query(
      `INSERT INTO task_instance_entity (task_id, user_id, title, priority, status, "templateId")
       VALUES ('task-I', 'U', 'i', 'Low', 'Pending', $1)`,
      [templatePk],
    );
    await ds.query(`DELETE FROM project_entity WHERE project_id = 'P1'`);
    expect(
      await ds.query(
        `SELECT "taskTemplate_id" AS id FROM task_template_entity ORDER BY 1`,
      ),
    ).toEqual([{ id: 'TMP-U' }, { id: 'TMP-V-P2' }]);
    expect(
      await ds.query(
        `SELECT task_id, "templateId" FROM task_instance_entity WHERE task_id = 'task-I'`,
      ),
    ).toEqual([{ task_id: 'task-I', templateId: null }]);
  });

  it('FK5 a template or token row for a missing user or project fails with 23503', async () => {
    await ds.runMigrations();
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { driverError?: { code?: string }; code?: string }) =>
          e.driverError?.code ?? e.code,
      );
    expect(
      await code(
        ds.query(`INSERT INTO task_template_entity
          (user_id, "taskTemplate_id", title, repeat_every, start_date)
          VALUES ('NOPE', 'TMP-X', 'x', 'Day', now())`),
      ),
    ).toBe('23503');
    expect(
      await code(
        ds.query(`INSERT INTO task_template_entity
          (user_id, project_id, "taskTemplate_id", title, repeat_every, start_date)
          VALUES ('U', 'NOPE', 'TMP-Y', 'y', 'Day', now())`),
      ),
    ).toBe('23503');
    expect(
      await code(
        ds.query(`INSERT INTO auth_token_entity
          (token_id, user_id, token, expires_at, is_revoked, family_id)
          VALUES ('tok-N', 'NOPE', 'h', now(), false, 'fam-N')`),
      ),
    ).toBe('23503');
  });

  it('FK6 up -> down -> up; down drops only the three foreign keys', async () => {
    await ds.runMigrations();
    await ds.undoLastMigration();
    expect(await fks()).toEqual([]);
    expect(
      await count('SELECT count(*)::int AS n FROM task_template_entity'),
    ).toBe(3);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NAME]);
  });
});
