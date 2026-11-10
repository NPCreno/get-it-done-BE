/**
 * HashPlaintextPasswords: rehashes non-bcrypt rows, is idempotent, rolls back
 * completely on failure, and its down() refuses to run. Uses its own DB.
 */
import { BASE_URL } from './int-env';
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { resetDatabase } from './int-db';
import { HashPlaintextPasswords1762900000000 } from '../src/migrations/1762900000000-HashPlaintextPasswords';
import { rehashPlaintextPasswords } from '../src/auth/rehash-passwords';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcrypt');
const DB = 'getitdone_test_migration';

class FailAfterFirstRow implements MigrationInterface {
  name = 'FailAfterFirstRow1762900000001';
  async up(q: QueryRunner) {
    await rehashPlaintextPasswords(q, {
      afterRow: (i) => {
        if (i === 0) throw new Error('injected failure');
      },
    });
  }
  async down() {}
}

describe('HashPlaintextPasswords migration', () => {
  let ds: DataSource;
  const makeDs = (migrations: unknown[]) =>
    new DataSource({
      type: 'postgres',
      url: `${BASE_URL}/${DB}`,
      migrations: migrations as never[],
      migrationsTransactionMode: 'all',
    });

  const hash12 = () => bcrypt.hashSync('already-hashed1', 12);

  async function seed(d: DataSource) {
    await d.query('DROP TABLE IF EXISTS users');
    await d.query('CREATE TABLE users (user_id varchar PRIMARY KEY, password varchar NOT NULL)');
    await d.query('INSERT INTO users VALUES ($1, $2), ($3, $4), ($5, $6)', [
      'u1', 'plain123', 'u2', hash12(), 'u3', 'other456',
    ]);
  }

  beforeEach(async () => {
    await resetDatabase(BASE_URL, DB);
  });

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('hashes only the non-bcrypt rows, logs a count, and is idempotent', async () => {
    ds = makeDs([HashPlaintextPasswords1762900000000]);
    await ds.initialize();
    await seed(ds);
    const keep = (await ds.query("SELECT password FROM users WHERE user_id = 'u2'"))[0].password;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await ds.runMigrations();
    const rows = await ds.query('SELECT user_id, password FROM users ORDER BY user_id');
    expect(rows[0].password).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.compareSync('plain123', rows[0].password)).toBe(true);
    expect(rows[1].password).toBe(keep);
    expect(bcrypt.compareSync('other456', rows[2].password)).toBe(true);

    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    expect(printed).toContain('rehashed 2 account(s)');
    expect(printed).not.toContain('plain123');
    expect(printed).not.toContain('u1');

    // second pass changes nothing
    expect(await ds.transaction((m) => rehashPlaintextPasswords(m))).toBe(0);
  });

  it('a failure after the first row rolls back every row and records no migration', async () => {
    ds = makeDs([FailAfterFirstRow]);
    await ds.initialize();
    await seed(ds);
    const before = await ds.query('SELECT user_id, password FROM users ORDER BY user_id');

    await expect(ds.runMigrations()).rejects.toThrow();
    expect(await ds.query('SELECT user_id, password FROM users ORDER BY user_id')).toEqual(before);
    const table = await ds.query("SELECT to_regclass('public.migrations') AS t");
    if (table[0].t) {
      expect(await ds.query('SELECT * FROM migrations')).toHaveLength(0);
    }
  });

  it('down() throws instead of silently doing nothing', async () => {
    await expect(new HashPlaintextPasswords1762900000000().down()).rejects.toThrow('Irreversible');
  });
});
