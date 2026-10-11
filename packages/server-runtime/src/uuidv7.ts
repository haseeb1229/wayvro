/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix-millisecond timestamp, version 7, 12 random bits, variant 0b10, 62 random bits.
 * Server-generated before insert (the field-encryption AAD binds ciphertext to the row id, data model §0/§8).
 * Ids are time-ordered across milliseconds; within one millisecond their order is random (no counter, no state).
 */
import { randomBytes } from 'node:crypto';

export function uuidv7(nowMs: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffff_ffff_ffff) throw new RangeError('timestamp out of UUIDv7 range');
  if (random.length < 10) throw new RangeError('UUIDv7 needs 10 random bytes');
  const b = Buffer.alloc(16);
  b.writeUIntBE(nowMs, 0, 6);
  b.set(random.subarray(0, 10), 6);
  b[6] = 0x70 | ((b[6] ?? 0) & 0x0f);
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Milliseconds encoded in a UUIDv7 (tests/diagnostics). */
export function uuidv7Timestamp(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
