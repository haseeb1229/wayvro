import { describe, expect, it } from 'vitest';
import { ipPrefix } from '../src/identity/otp-abuse.js';

describe('client IP prefixes for abuse limits (IPv4 /24, IPv6 /56)', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12ff::1', '2001:0db8:abcd:1200::/56'],
    ['2001:db8:abcd:1234:5678:9abc:def0:1234', '2001:0db8:abcd:1200::/56'],
    ['::1', '0000:0000:0000:0000::/56'],
    ['2001:db8::', '2001:0db8:0000:0000::/56'],
  ])('%s -> %s', (ip, prefix) => {
    expect(ipPrefix(ip)).toBe(prefix);
  });

  it('groups addresses of one /56 together and rejects unparseable input', () => {
    expect(ipPrefix('2001:db8:abcd:1201::9')).toBe(ipPrefix('2001:db8:abcd:12ff:ffff::1'));
    expect(ipPrefix('2001:db8:abcd:1300::1')).not.toBe(ipPrefix('2001:db8:abcd:12ff::1'));
    expect(ipPrefix('not-an-ip')).toBeNull();
    expect(ipPrefix('')).toBeNull();
  });
});
