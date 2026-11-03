import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { counterBytes } from '../../__mocks__/memory-store';
import { newUuidV4 } from './ids';

describe('newUuidV4 (per-field search sessions, quote attempts)', () => {
  it('produces RFC 4122 version-4 UUIDs the contracts accept, distinct per call', () => {
    const random = counterBytes();
    const a = newUuidV4(random);
    const b = newUuidV4(random);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(z.uuid().safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });

  it('sets the version and variant bits whatever the random bytes are', () => {
    expect(newUuidV4((n) => new Uint8Array(n).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(newUuidV4((n) => new Uint8Array(n))).toBe('00000000-0000-4000-8000-000000000000');
  });
});
