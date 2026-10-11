import * as Crypto from 'expo-crypto';
import type { RandomBytes } from './ids';

/** OS CSPRNG via expo-crypto (no permission, no network). */
export const randomBytes: RandomBytes = (byteCount) => Crypto.getRandomBytes(byteCount);

/** Hex SHA-256 of a UTF-8 string (request fingerprints for idempotency intents; never sent anywhere). */
export const sha256Hex = (value: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.HEX });
