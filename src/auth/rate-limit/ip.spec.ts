import { normalizeIp } from './ip';

describe('normalizeIp (U1)', () => {
  it('keeps IPv4 and unwraps IPv4-mapped IPv6', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
  });
  it('gives one canonical form per IPv6 /64', () => {
    expect(normalizeIp('2001:DB8::1')).toBe(normalizeIp('2001:0db8:0:0::1'));
    expect(normalizeIp('2001:db8:0:0:1:2:3:4')).toBe(
      normalizeIp('2001:db8:0:0:ffff::9'),
    );
    expect(normalizeIp('2001:db8:0:1::1')).not.toBe(normalizeIp('2001:db8::1'));
    expect(normalizeIp('2001:db8::1')).toMatch(/\/64$/);
  });
  it('strips a zone id and keeps loopback', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe(normalizeIp('fe80::1'));
    expect(normalizeIp('::1')).toBe('::1');
  });
  it('returns null for anything that is not an IP', () => {
    for (const bad of ['', 'nope', '1.2.3.4, 5.6.7.8', '1.2.3', undefined, 5]) {
      expect(normalizeIp(bad)).toBeNull();
    }
    expect(normalizeIp('a'.repeat(100))).toBeNull();
  });
});
