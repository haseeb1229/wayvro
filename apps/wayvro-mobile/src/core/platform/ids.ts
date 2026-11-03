/**
 * Random identifiers (installation id, idempotency keys, request ids). Pure: the caller supplies the CSPRNG
 * (`expo-crypto` in the app, a deterministic source in tests).
 */
export type RandomBytes = (byteCount: number) => Uint8Array;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 §5 base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63) + ALPHABET.charAt((n >> 6) & 63) + ALPHABET.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63) + ALPHABET.charAt((n >> 6) & 63);
  }
  return out;
}

/** 128-bit installation id: 22 base64url characters (matches the contract `^[A-Za-z0-9_-]{16,128}$`). */
export const newInstallationId = (random: RandomBytes): string => base64Url(random(16));

/** 192-bit idempotency key: 32 base64url characters. */
export const newIdempotencyKey = (random: RandomBytes): string => base64Url(random(24));

/** 96-bit request id: 16 base64url characters (contract `^[A-Za-z0-9_-]{8,64}$`). */
export const newRequestId = (random: RandomBytes): string => base64Url(random(12));

/** RFC 4122 version-4 UUID from 16 random bytes (per-field search session ids, quote attempts; never an identity). */
export function newUuidV4(random: RandomBytes): string {
  const bytes = random(16);
  let hex = '';
  for (let i = 0; i < 16; i += 1) {
    let value = bytes[i] ?? 0;
    if (i === 6) value = (value & 0x0f) | 0x40;
    if (i === 8) value = (value & 0x3f) | 0x80;
    hex += value.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
