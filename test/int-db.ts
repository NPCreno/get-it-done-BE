// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');

/** Creates the database on demand and wipes its public schema. Never touches any other DB. */
export async function resetDatabase(baseUrl: string, dbName: string): Promise<void> {
  if (!/^getitdone_test[a-z_]*$/.test(dbName)) throw new Error('refusing to reset a non-test database');
  const admin = new Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (r.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const c = new Client({ connectionString: `${baseUrl}/${dbName}` });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

export async function queryDb<T = any>(baseUrl: string, dbName: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: `${baseUrl}/${dbName}` });
  await c.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows as T[];
  } finally {
    await c.end();
  }
}
