// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcrypt');

export const BCRYPT_REGEX = '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$';

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<any>;
}

/**
 * Hashes every users.password that is not already a bcrypt hash. All SQL goes
 * through the given Queryable, so a caller inside a transaction gets
 * all-or-nothing. Returns the COUNT only: no ids and no values are ever
 * logged or returned. `afterRow` exists for failure-injection tests.
 */
export async function rehashPlaintextPasswords(
  q: Queryable,
  opts: { afterRow?: (index: number) => void } = {},
): Promise<number> {
  const rows: { user_id: string; password: string }[] = await q.query(
    'SELECT user_id, password FROM users WHERE password !~ $1 FOR UPDATE',
    [BCRYPT_REGEX],
  );
  let index = 0;
  for (const row of rows) {
    const hash: string = await bcrypt.hash(String(row.password), 12);
    await q.query('UPDATE users SET password = $1 WHERE user_id = $2', [
      hash,
      row.user_id,
    ]);
    opts.afterRow?.(index);
    index += 1;
  }
  return rows.length;
}
