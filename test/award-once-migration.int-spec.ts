/** AwardOnce migration: lifetime backfill, exact (type,title) award backfill, unmapped report, up/down/up. Own DB. */
import { BASE_URL } from './int-env';
import { DataSource } from 'typeorm';
import { resetDatabase } from './int-db';
import { AwardOnce1763000000000 } from '../src/migrations/1763000000000-AwardOnce';

const DB = 'getitdone_test_award_migration';

describe('AwardOnce migration', () => {
  let ds: DataSource;
  let log: jest.SpyInstance;

  const seedSchema = async () => {
    await ds.query(
      'CREATE TABLE users (user_id varchar PRIMARY KEY, fullname varchar)',
    );
    await ds.query(`CREATE TABLE task_instance_entity (
      id serial PRIMARY KEY, user_id varchar, status varchar, "deletedAt" timestamp)`);
    await ds.query(`CREATE TABLE notifications (
      id serial PRIMARY KEY, user_id varchar, type varchar, title varchar, metadata text)`);
    await ds.query("INSERT INTO users VALUES ('X','x'),('Y','y')");
    for (let i = 0; i < 7; i++)
      await ds.query(
        "INSERT INTO task_instance_entity (user_id,status) VALUES ('X','Complete')",
      );
    for (let i = 0; i < 2; i++)
      await ds.query(
        `INSERT INTO task_instance_entity (user_id,status,"deletedAt") VALUES ('X','Complete', now())`,
      );
    await ds.query(
      "INSERT INTO task_instance_entity (user_id,status) VALUES ('X','Pending')",
    );
  };
  const notif = (user: string, type: string, title: string, meta?: unknown) =>
    ds.query(
      'INSERT INTO notifications (user_id,type,title,metadata) VALUES ($1,$2,$3,$4)',
      [user, type, title, meta === undefined ? null : JSON.stringify(meta)],
    );
  const awards = async (user: string) =>
    (
      await ds.query(
        'SELECT award_key FROM user_awards WHERE user_id=$1 ORDER BY 1',
        [user],
      )
    ).map((r: { award_key: string }) => r.award_key);
  const printed = () => log.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(async () => {
    await resetDatabase(BASE_URL, DB);
    ds = new DataSource({
      type: 'postgres',
      url: `${BASE_URL}/${DB}`,
      migrations: [AwardOnce1763000000000],
      migrationsTransactionMode: 'all',
    });
    await ds.initialize();
    await seedSchema();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    log.mockRestore();
    if (ds?.isInitialized) await ds.destroy();
  });

  it('M1 lifetime count = current non-deleted completed tasks', async () => {
    await ds.runMigrations();
    const r = await ds.query(
      'SELECT user_id, lifetime_completed_count AS c FROM users ORDER BY user_id',
    );
    expect(r).toEqual([
      { user_id: 'X', c: 7 },
      { user_id: 'Y', c: 0 },
    ]);
  });

  it('M2 maps only exact rows; M3 users without notifications get no keys', async () => {
    await notif('X', 'achievement', 'First Task Completed!');
    await notif('X', 'milestone', 'Milestone Achieved!', {
      completedCount: 10,
    });
    await notif('X', 'streak', '1-Day Streak'); // never backfilled
    await ds.runMigrations();
    expect(await awards('X')).toEqual([
      'achievement:eq:1',
      'milestone:every:10:10',
    ]);
    expect(await awards('Y')).toEqual([]);
  });

  it('M4 unmatched rows give no key and are reported with counts', async () => {
    await notif('X', 'achievement', 'Some Old Title');
    await notif('Y', 'achievement', 'Some Old Title');
    await notif('X', 'levelUp', 'Task Master');
    await notif('X', 'milestone', 'Milestone Achieved!', {
      completedCount: 15,
    });
    await notif('X', 'milestone', 'Milestone Achieved!', {
      completedCount: 'abc',
    });
    await ds.query(
      "INSERT INTO notifications (user_id,type,title,metadata) VALUES ('Y','milestone','Milestone Achieved!','not json')",
    );
    await ds.runMigrations();
    expect(await awards('X')).toEqual([]);
    expect(await awards('Y')).toEqual([]);
    const out = printed();
    expect(out).toContain('0 award(s) from 6 notification row(s); 6 unmapped');
    expect(out).toContain(
      'type=achievement title="Some Old Title" reason=unknown title count=2',
    );
    expect(out).toContain(
      'type=levelUp title="Task Master" reason=title mapped under a different type count=1',
    );
    expect(out).toContain('reason=completedCount not a multiple of 10 count=1');
    expect(out).toContain('reason=invalid completedCount count=2');
    expect(out).not.toMatch(/user_id|notif-/);
  });

  it('M5 up -> down -> up gives the same state, and down restores the schema', async () => {
    await notif('X', 'achievement', 'Half Century!');
    const cols = () =>
      ds.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY 1",
      );
    const before = await cols();
    await ds.runMigrations();
    const state = async () => ({
      lifetime: await ds.query(
        'SELECT user_id, lifetime_completed_count FROM users ORDER BY user_id',
      ),
      awards: await awards('X'),
    });
    const first = await state();
    await ds.undoLastMigration();
    expect(await cols()).toEqual(before);
    expect(
      await ds.query("SELECT to_regclass('public.user_awards') AS t"),
    ).toEqual([{ t: null }]);
    await ds.runMigrations();
    expect(await state()).toEqual(first);
    expect(first.awards).toEqual(['achievement:eq:50']);
  });
});
