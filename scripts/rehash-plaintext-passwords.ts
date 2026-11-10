/**
 * Idempotent straggler cleanup: run after the new backend is live if the
 * post-migration check still finds non-bcrypt passwords. Logs counts only.
 * Usage: npm run db:rehash-passwords
 */
import dataSource from '../src/data-source';
import { rehashPlaintextPasswords } from '../src/auth/rehash-passwords';

async function main() {
  await dataSource.initialize();
  try {
    const count = await dataSource.transaction((m) => rehashPlaintextPasswords(m));
    console.log(`rehashed ${count} account(s)`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch(() => {
  console.error('rehash failed; no changes were committed');
  process.exit(1);
});
