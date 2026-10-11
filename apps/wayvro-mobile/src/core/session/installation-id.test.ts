import { InstallationIdSchema } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { counterBytes, MemoryStore } from '../../__mocks__/memory-store';
import { loadOrCreateInstallationId } from './installation-id';
import { STORAGE_KEYS } from './key-value-store';

describe('installation id', () => {
  it('creates a random contract-valid id once and persists it in secure storage', async () => {
    const store = new MemoryStore();
    const first = await loadOrCreateInstallationId(store, counterBytes());
    expect(InstallationIdSchema.safeParse(first).success).toBe(true);
    expect(store.data.get(STORAGE_KEYS.installationId)).toBe(first);
    const second = await loadOrCreateInstallationId(store, counterBytes(99));
    expect(second).toBe(first);
  });

  it('replaces a stored value that does not match the contract shape', async () => {
    const store = new MemoryStore();
    await store.setItem(STORAGE_KEYS.installationId, 'short');
    const id = await loadOrCreateInstallationId(store, counterBytes());
    expect(id).not.toBe('short');
    expect(InstallationIdSchema.safeParse(id).success).toBe(true);
  });
});
