/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * SEC-07: compatibility of stored bcrypt hashes across library versions.
 * The fixed hashes below were generated once with bcrypt 5.1.1 (test-only
 * strings, not secrets). They must verify unchanged on every later version.
 */
// bcrypt ships no type declarations
const bcrypt = require('bcrypt');

const PASSWORD = 'Passw0rd1';
// production cost and prefix
const HASH_COST_12 =
  '$2b$12$F10/NKvOHM7o5ylyzgd6WOiTTRwhUyc1siKzqnJzSKLuHT6vzJ/V6';
// legacy refresh-row shape: a 200-character token-like string at cost 4
const TOKEN = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'x'.repeat(200)).slice(
  0,
  200,
);
const HASH_TOKEN_COST_4 =
  '$2b$04$/fMegIKAUnyHF5EVlVcaO.55AjhmrJDUrEZ.yYpHky.kSWbVd5Gbm';
// older prefix ($2a$), same algorithm
const HASH_2A_COST_10 =
  '$2a$10$Jnng5lnUQa1a60eTpAoG5OhsHAMSAMyClyiJfmw1.gbNKfzTrBOP6';

describe('bcrypt stored-hash compatibility (SEC-07)', () => {
  it.each([
    ['cost 12 $2b$', PASSWORD, HASH_COST_12],
    ['legacy token cost 4', TOKEN, HASH_TOKEN_COST_4],
    ['older $2a$ prefix', 'abc123', HASH_2A_COST_10],
  ])('%s: correct value verifies, wrong value does not', async (_n, pw, h) => {
    expect(await bcrypt.compare(pw, h)).toBe(true);
    expect(await bcrypt.compare('definitely-wrong', h)).toBe(false);
    expect(bcrypt.compareSync(pw, h)).toBe(true);
  });

  it('hash(pw, 12) keeps the production format and round-trips', async () => {
    const h: string = await bcrypt.hash(PASSWORD, 12);
    expect(h).toMatch(/^\$2b\$12\$.{53}$/);
    expect(await bcrypt.compare(PASSWORD, h)).toBe(true);
    expect(await bcrypt.compare('other', h)).toBe(false);
  });

  it('pins the 72-byte truncation (legacy refresh rows depend on it)', async () => {
    const sameFirst72 = TOKEN.slice(0, 72) + 'DIFFERENT-TAIL'.repeat(10);
    expect(await bcrypt.compare(sameFirst72, HASH_TOKEN_COST_4)).toBe(true);
    const differsEarly = 'Z' + TOKEN.slice(1);
    expect(await bcrypt.compare(differsEarly, HASH_TOKEN_COST_4)).toBe(false);
  });
});
