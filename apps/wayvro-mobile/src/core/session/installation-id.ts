import { InstallationIdSchema } from '@wayvro/contracts';
import { newInstallationId, type RandomBytes } from '../platform/ids';
import { STORAGE_KEYS, type KeyValueStore } from './key-value-store';

/**
 * App-generated random installation id (never a hardware identifier). Created once, kept in secure storage and kept
 * across sign-out/session expiry; a reinstall (or OS data wipe) creates a new one. A stored value that does not match
 * the contract shape is replaced rather than sent.
 */
export async function loadOrCreateInstallationId(store: KeyValueStore, random: RandomBytes): Promise<string> {
  const existing = await store.getItem(STORAGE_KEYS.installationId);
  if (existing !== null && InstallationIdSchema.safeParse(existing).success) return existing;
  const created = newInstallationId(random);
  await store.setItem(STORAGE_KEYS.installationId, created);
  return created;
}
