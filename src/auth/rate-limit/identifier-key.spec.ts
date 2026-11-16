import { identifierKey } from './identifier-key';

describe('identifierKey (U3)', () => {
  it('namespaces by the lookup field, not the endpoint', () => {
    const email = identifierKey({ email: 'a@b.co' });
    const user = identifierKey({ username: 'abc' });
    expect(email).toMatch(/^id:[0-9a-f]{64}$/);
    expect(email).not.toBe(user);
    // an email-like value sent as "username" is looked up as an email
    expect(identifierKey({ username: 'a@b.co' })).toBe(email);
    // a non-email value sent as "email" is looked up as a username
    expect(identifierKey({ email: 'abc' })).toBe(user);
  });
  it('does not fold case or trim (lookup is exact)', () => {
    expect(identifierKey({ username: 'Abc' })).not.toBe(
      identifierKey({ username: 'abc' }),
    );
    expect(identifierKey({ username: 'abc ' })).not.toBe(
      identifierKey({ username: 'abc' }),
    );
  });
  it('is null for missing, empty, non-string or oversized values', () => {
    for (const body of [
      undefined,
      null,
      'x',
      {},
      { username: '' },
      { username: 5 },
      { email: { $ne: 1 } },
      { username: 'a'.repeat(201) },
    ]) {
      expect(identifierKey(body)).toBeNull();
    }
    expect(identifierKey({ username: 'a'.repeat(200) })).not.toBeNull();
  });
});
