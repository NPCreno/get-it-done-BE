/** ProjectChat migration on a seeded pre-chat schema: tables, keys, index, cascades, up/down/up. Own DB. */
import { BASE_URL } from './int-env';
import { DataSource } from 'typeorm';
import { resetDatabase } from './int-db';
import { ProjectChat1763100000000 } from '../src/migrations/1763100000000-ProjectChat';

const DB = 'getitdone_test_chat_migration';
const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

interface Col {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  len: number | null;
  prec: number | null;
}

describe('ProjectChat migration', () => {
  let ds: DataSource;

  // The parts of the production schema the migration references (Nov 2025 shape).
  const seedSchema = async () => {
    await ds.query(`CREATE TABLE users (
      id serial PRIMARY KEY, user_id varchar NOT NULL UNIQUE,
      username varchar NOT NULL UNIQUE, "deletedAt" timestamp)`);
    await ds.query(`CREATE TABLE project_entity (
      id serial PRIMARY KEY, project_id varchar NOT NULL UNIQUE,
      user_id varchar NOT NULL, title varchar, "deletedAt" timestamp)`);
    await ds.query(
      "INSERT INTO users (user_id, username) VALUES ('O','o'),('M','m'),('N','n')",
    );
    await ds.query(
      "INSERT INTO project_entity (project_id, user_id, title) VALUES ('P1','O','one'),('P2','O','two')",
    );
  };
  const count = async (table: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n as number;

  beforeEach(async () => {
    await resetDatabase(BASE_URL, DB);
    ds = new DataSource({
      type: 'postgres',
      url: `${BASE_URL}/${DB}`,
      migrations: [ProjectChat1763100000000],
      migrationsTransactionMode: 'all',
    });
    await ds.initialize();
    await seedSchema();
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('CM1 creates both tables with the planned columns, keys and indexes', async () => {
    await ds.runMigrations();
    const cols: Col[] = await ds.query(
      `SELECT table_name, column_name, data_type, is_nullable,
              character_maximum_length AS len, datetime_precision AS prec
         FROM information_schema.columns
        WHERE table_name IN ('project_members', 'chat_messages')
        ORDER BY table_name, ordinal_position`,
    );
    expect(
      cols.map(
        (c) =>
          `${c.table_name}.${c.column_name} ${c.data_type}${c.len ? `(${c.len})` : ''} ${c.is_nullable === 'YES' ? 'null' : 'not null'}`,
      ),
    ).toEqual([
      'chat_messages.id uuid not null',
      'chat_messages.project_id character varying not null',
      'chat_messages.user_id character varying not null',
      'chat_messages.body character varying(2000) not null',
      'chat_messages.created_at timestamp with time zone not null',
      'chat_messages.deleted_at timestamp with time zone null',
      'project_members.project_id character varying not null',
      'project_members.user_id character varying not null',
      'project_members.added_by character varying not null',
      'project_members.created_at timestamp with time zone not null',
    ]);
    const prec = cols
      .filter((c) => c.table_name === 'chat_messages' && c.prec !== null)
      .map((c) => c.prec);
    expect(prec).toEqual([3, 3]);

    const idx = await ds.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('project_members', 'chat_messages') ORDER BY indexname`,
    );
    const def = (name: string) =>
      idx.find((i: { indexname: string }) => i.indexname === name)?.indexdef;
    expect(def('IDX_chat_messages_project_created_id')).toContain(
      '(project_id, created_at DESC, id)',
    );
    expect(def('IDX_chat_messages_user')).toContain('(user_id)');
    expect(def('IDX_project_members_user')).toContain('(user_id)');
    expect(def('PK_project_members')).toContain('(project_id, user_id)');
    expect(def('PK_chat_messages')).toContain('(id)');
  });

  it('CM2 enforces the keys and the body limit', async () => {
    await ds.runMigrations();
    await ds.query(
      "INSERT INTO project_members (project_id, user_id, added_by) VALUES ('P1','M','O')",
    );
    await expect(
      ds.query(
        "INSERT INTO project_members (project_id, user_id, added_by) VALUES ('P1','M','O')",
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      ds.query(
        "INSERT INTO project_members (project_id, user_id, added_by) VALUES ('NOPE','M','O')",
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      ds.query(
        "INSERT INTO chat_messages (id, project_id, user_id, body) VALUES ($1,'P1','ZZ','x')",
        [ID1],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      ds.query(
        "INSERT INTO chat_messages (id, project_id, user_id, body) VALUES ($1,'P1','M',$2)",
        [ID1, 'x'.repeat(2001)],
      ),
    ).rejects.toThrow(/too long/);
    const [row] = await ds.query(
      "INSERT INTO chat_messages (id, project_id, user_id, body) VALUES ($1,'P1','M','hi') RETURNING created_at, deleted_at",
      [ID1],
    );
    expect(row.deleted_at).toBeNull();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('CM3 cascades on project and user delete, and leaves other rows alone', async () => {
    await ds.runMigrations();
    await ds.query(
      "INSERT INTO project_members (project_id, user_id, added_by) VALUES ('P1','M','O'),('P2','M','O'),('P2','N','O')",
    );
    await ds.query(
      "INSERT INTO chat_messages (id, project_id, user_id, body) VALUES ($1,'P1','M','a'),($2,'P2','N','b')",
      [ID1, ID2],
    );
    await ds.query("DELETE FROM project_entity WHERE project_id = 'P1'");
    expect(await count('project_members')).toBe(2);
    expect(await count('chat_messages')).toBe(1);
    await ds.query("DELETE FROM users WHERE user_id = 'N'");
    expect(
      await ds.query('SELECT project_id, user_id FROM project_members'),
    ).toEqual([{ project_id: 'P2', user_id: 'M' }]);
    expect(await count('chat_messages')).toBe(0);
  });

  it('CM4 up -> down -> up; down removes only the new tables', async () => {
    const tables = () =>
      ds.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
      );
    const before = await tables();
    await ds.runMigrations();
    expect((await tables()).length).toBe(before.length + 3); // + migrations table
    await ds.undoLastMigration();
    expect(
      (await tables()).filter(
        (t: { table_name: string }) => t.table_name !== 'migrations',
      ),
    ).toEqual(before);
    expect(await count('project_entity')).toBe(2);
    expect(await count('users')).toBe(3);
    await ds.runMigrations();
    expect(await count('project_members')).toBe(0);
  });

  it('CM5 the entities describe the same columns and constraints as the migration', async () => {
    const shape = (d: DataSource) =>
      d.query(
        `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
                c.character_maximum_length AS len, c.datetime_precision AS prec,
                c.column_default AS def
           FROM information_schema.columns c
          WHERE c.table_name IN ('project_members', 'chat_messages')
          ORDER BY c.table_name, c.column_name`,
      );
    const constraints = (d: DataSource) =>
      d.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid IN ('project_members'::regclass, 'chat_messages'::regclass)
          ORDER BY conname`,
      );
    await ds.runMigrations();
    const migrated = { cols: await shape(ds), cons: await constraints(ds) };

    const SYNC_DB = 'getitdone_test_chat_sync';
    await resetDatabase(BASE_URL, SYNC_DB);
    const synced = new DataSource({
      type: 'postgres',
      url: `${BASE_URL}/${SYNC_DB}`,
      entities: [__dirname + '/../src/**/*.entity.ts'],
      synchronize: true,
    });
    await synced.initialize();
    try {
      expect(await shape(synced)).toEqual(migrated.cols);
      expect(await constraints(synced)).toEqual(migrated.cons);
    } finally {
      await synced.destroy();
    }
  }, 60000);
});
