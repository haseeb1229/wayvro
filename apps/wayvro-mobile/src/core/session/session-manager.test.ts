import type { SessionTokens } from '@wayvro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { tokens } from '../../__mocks__/fixtures';
import { MemoryStore } from '../../__mocks__/memory-store';
import { ApiError } from '../api/errors';
import { STORAGE_KEYS } from './key-value-store';
import { SessionManager, type RefreshCall } from './session-manager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(refreshCall: RefreshCall, store = new MemoryStore()) {
  let n = 0;
  const manager = new SessionManager({
    store,
    refreshCall,
    newIdempotencyKey: () => {
      n += 1;
      return `refresh_key_${String(n).padStart(12, '0')}`;
    },
  });
  return { manager, store };
}

const stored = (store: MemoryStore) =>
  JSON.parse(store.data.get(STORAGE_KEYS.session) ?? 'null') as (SessionTokens & { pendingRefreshKey: string | null }) | null;

describe('SessionManager', () => {
  it('loads a persisted session and wipes corrupt data (fail closed)', async () => {
    const { manager, store } = setup(vi.fn());
    await manager.load();
    expect(manager.getState()).toEqual({ status: 'signed-out', reason: 'none' });

    await store.setItem(STORAGE_KEYS.session, '{"v":1,"accessToken":');
    await manager.load();
    expect(manager.getState().status).toBe('signed-out');
    expect(store.data.has(STORAGE_KEYS.session)).toBe(false);

    await manager.establish(tokens(1));
    const again = setup(vi.fn(), store).manager;
    await again.load();
    expect(again.getState()).toEqual({ status: 'signed-in', sessionId: tokens(1).sessionId });
    expect(again.accessToken()).toBe(tokens(1).accessToken);
  });

  it('single-flight: N concurrent 401s cause exactly one refresh, and all waiters see the new token', async () => {
    const gate = deferred<SessionTokens>();
    const refreshCall = vi.fn<RefreshCall>(() => gate.promise);
    const { manager } = setup(refreshCall);
    await manager.establish(tokens(1));
    const stale = tokens(1).accessToken;
    const waiters = Array.from({ length: 8 }, () => manager.refreshAfterUnauthorized(stale));
    gate.resolve(tokens(2));
    expect(await Promise.all(waiters)).toEqual(Array(8).fill('refreshed'));
    expect(refreshCall).toHaveBeenCalledTimes(1);
    expect(manager.accessToken()).toBe(tokens(2).accessToken);
    // A late 401 carrying the already-rotated token does not refresh again.
    expect(await manager.refreshAfterUnauthorized(stale)).toBe('refreshed');
    expect(refreshCall).toHaveBeenCalledTimes(1);
  });

  it('persists the new token pair BEFORE releasing waiters', async () => {
    const store = new MemoryStore();
    const { manager } = setup(() => Promise.resolve(tokens(2)), store);
    await manager.establish(tokens(1));
    const outcome = await manager.refreshAfterUnauthorized(tokens(1).accessToken);
    // At the moment the waiter resumes, secure storage already holds the rotated pair with no pending key.
    expect(outcome).toBe('refreshed');
    expect(stored(store)?.refreshToken).toBe(tokens(2).refreshToken);
    expect(stored(store)?.pendingRefreshKey).toBeNull();
  });

  it('persists the refresh idempotency key before sending, and reuses it after a lost response (also across restarts)', async () => {
    const store = new MemoryStore();
    const seenKeys: string[] = [];
    let call = 0;
    const refreshCall: RefreshCall = (_token, key) => {
      seenKeys.push(key);
      // The key must already be in secure storage when the request goes out.
      expect(stored(store)?.pendingRefreshKey).toBe(key);
      call += 1;
      return call === 1 ? Promise.reject(new ApiError('offline', { transient: true })) : Promise.resolve(tokens(2));
    };
    const { manager } = setup(refreshCall, store);
    await manager.establish(tokens(1));
    await expect(manager.refreshAfterUnauthorized(tokens(1).accessToken)).rejects.toBeInstanceOf(ApiError);
    // Outcome unknown: tokens and pending key are kept.
    expect(manager.getState().status).toBe('signed-in');
    expect(stored(store)?.refreshToken).toBe(tokens(1).refreshToken);

    // Simulated app restart: a new manager over the same storage.
    const restarted = setup(refreshCall, store).manager;
    await restarted.load();
    expect(await restarted.refreshAfterUnauthorized(tokens(1).accessToken)).toBe('refreshed');
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]);
  });

  it('a refused refresh (401) expires the session and wipes tokens and installation-scoped data', async () => {
    const store = new MemoryStore();
    const { manager } = setup(() => Promise.reject(new ApiError('session-expired', { status: 401, code: 'WAYVRO_E_UNAUTHENTICATED' })), store);
    const wiped = vi.fn();
    manager.onWipe(wiped);
    await store.setItem(STORAGE_KEYS.installationId, 'installation_id_0000001');
    await manager.establish(tokens(1));
    expect(await manager.refreshAfterUnauthorized(tokens(1).accessToken)).toBe('expired');
    expect(manager.getState()).toEqual({ status: 'signed-out', reason: 'expired' });
    expect(manager.accessToken()).toBeNull();
    expect(store.data.has(STORAGE_KEYS.session)).toBe(false);
    expect(store.data.has(STORAGE_KEYS.installationId)).toBe(true);
    expect(wiped).toHaveBeenCalledTimes(1);
  });

  it('keeps the session on a rate-limited refresh (transient for the client)', async () => {
    const { manager } = setup(() => Promise.reject(new ApiError('rate-limited', { status: 429, retryAfterSeconds: 5 })));
    await manager.establish(tokens(1));
    await expect(manager.refreshAfterUnauthorized(tokens(1).accessToken)).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(manager.getState().status).toBe('signed-in');
  });

  it('a sign-out during an in-flight refresh is not undone by the refresh result', async () => {
    const gate = deferred<SessionTokens>();
    const store = new MemoryStore();
    const { manager } = setup(() => gate.promise, store);
    await manager.establish(tokens(1));
    const pending = manager.refreshAfterUnauthorized(tokens(1).accessToken);
    await Promise.resolve();
    await manager.clear('signed-out');
    gate.resolve(tokens(2));
    expect(await pending).toBe('expired');
    expect(manager.accessToken()).toBeNull();
    expect(store.data.has(STORAGE_KEYS.session)).toBe(false);
    expect(manager.getState()).toEqual({ status: 'signed-out', reason: 'signed-out' });
  });

  it('a sign-out while a session write is still in progress leaves nothing in storage or memory', async () => {
    const store = new MemoryStore();
    const writeGate = deferred<undefined>();
    let slow = false;
    const slowStore = {
      getItem: (k: string) => store.getItem(k),
      deleteItem: (k: string) => store.deleteItem(k),
      setItem: async (k: string, v: string) => {
        if (slow) await writeGate.promise;
        await store.setItem(k, v);
      },
    };
    const manager = new SessionManager({
      store: slowStore,
      refreshCall: () => Promise.resolve(tokens(2)),
      newIdempotencyKey: () => 'refresh_key_000000000001',
    });
    await manager.establish(tokens(1));
    slow = true;
    const pending = manager.refreshAfterUnauthorized(tokens(1).accessToken);
    // Let the pending-key write start (it is now blocked inside secure storage), then sign out.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    const cleared = manager.clear('signed-out');
    writeGate.resolve(undefined);
    await Promise.all([pending, cleared]);
    expect(store.data.has(STORAGE_KEYS.session)).toBe(false);
    expect(manager.accessToken()).toBeNull();
    expect(manager.getState().status).toBe('signed-out');
  });

  it('reports an incomplete wipe instead of throwing, after dropping tokens', async () => {
    const { manager } = setup(vi.fn());
    await manager.establish(tokens(1));
    manager.onWipe(() => Promise.reject(new Error('storage busy')));
    const second = vi.fn();
    manager.onWipe(second);
    expect(await manager.clear('signed-out')).toEqual({ complete: false });
    expect(second).toHaveBeenCalled();
    expect(manager.accessToken()).toBeNull();
  });

  it('notifies subscribers of state changes', async () => {
    const { manager } = setup(vi.fn());
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    await manager.load();
    await manager.establish(tokens(1));
    unsubscribe();
    await manager.clear('signed-out');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
