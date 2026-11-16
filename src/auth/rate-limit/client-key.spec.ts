import { Request } from 'express';
import { clientKey } from './client-key';

const SECRET = 'internal-secret';
const mk = (
  headers: Record<string, string | string[]>,
  remote = '10.0.0.9',
): Request =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as Request;

describe('clientKey (U2)', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.INTERNAL_API_SECRET;
  });

  it('valid secret + IP is attested', () => {
    expect(
      clientKey(mk({ 'x-internal-secret': SECRET, 'x-client-ip': '1.2.3.4' })),
    ).toEqual({ kind: 'attested', key: 'ip:1.2.3.4' });
  });
  it('valid secret without a usable IP is bff-noip', () => {
    expect(clientKey(mk({ 'x-internal-secret': SECRET }))).toEqual({
      kind: 'bff-noip',
      key: 'bff-noip',
    });
    expect(
      clientKey(mk({ 'x-internal-secret': SECRET, 'x-client-ip': 'junk' }))
        .kind,
    ).toBe('bff-noip');
  });
  it('never reads a spoofed X-Client-IP without the secret', () => {
    const k = clientKey(
      mk({ 'x-client-ip': '9.9.9.9', 'x-internal-secret': 'wrong' }),
    );
    expect(k.kind).toBe('unattested');
    expect(k.key).not.toContain('9.9.9.9');
    expect(k.key).toBe('sock:10.0.0.9');
  });
  it('uses a single valid X-Real-IP for unattested callers', () => {
    expect(clientKey(mk({ 'x-real-ip': '5.6.7.8' }))).toEqual({
      kind: 'unattested',
      key: 'xri:5.6.7.8',
    });
  });
  it('falls back to the socket for multi-value or invalid X-Real-IP', () => {
    expect(clientKey(mk({ 'x-real-ip': '5.6.7.8, 1.1.1.1' })).key).toBe(
      'sock:10.0.0.9',
    );
    expect(clientKey(mk({ 'x-real-ip': ['5.6.7.8', '1.1.1.1'] })).key).toBe(
      'sock:10.0.0.9',
    );
    expect(clientKey(mk({ 'x-real-ip': 'abc' })).key).toBe('sock:10.0.0.9');
  });
  it('ignores X-Forwarded-For', () => {
    expect(clientKey(mk({ 'x-forwarded-for': '8.8.8.8' })).key).toBe(
      'sock:10.0.0.9',
    );
  });
  it('with no INTERNAL_API_SECRET nothing is attested', () => {
    delete process.env.INTERNAL_API_SECRET;
    expect(
      clientKey(mk({ 'x-internal-secret': SECRET, 'x-client-ip': '1.2.3.4' }))
        .kind,
    ).toBe('unattested');
  });
});
