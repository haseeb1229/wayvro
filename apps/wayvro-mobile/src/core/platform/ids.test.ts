import { IdempotencyKeySchema, InstallationIdSchema, RequestIdSchema } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { counterBytes } from '../../__mocks__/memory-store';
import { base64Url, newIdempotencyKey, newInstallationId, newRequestId } from './ids';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('ids', () => {
  it('encodes RFC 4648 base64url without padding', () => {
    expect(base64Url(bytes())).toBe('');
    expect(base64Url(bytes(0x66))).toBe('Zg');
    expect(base64Url(bytes(0x66, 0x6f))).toBe('Zm8');
    expect(base64Url(bytes(0x66, 0x6f, 0x6f))).toBe('Zm9v');
    expect(base64Url(bytes(0xfb, 0xff, 0xbf))).toBe('-_-_');
  });

  it('produces contract-valid installation ids (128-bit), idempotency keys and request ids', () => {
    const random = counterBytes();
    const installationId = newInstallationId(random);
    expect(installationId).toHaveLength(22);
    expect(InstallationIdSchema.safeParse(installationId).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse(newIdempotencyKey(random)).success).toBe(true);
    expect(RequestIdSchema.safeParse(newRequestId(random)).success).toBe(true);
  });

  it('asks the CSPRNG for exactly 16 bytes for an installation id', () => {
    const sizes: number[] = [];
    newInstallationId((n) => {
      sizes.push(n);
      return new Uint8Array(n);
    });
    expect(sizes).toEqual([16]);
  });
});
