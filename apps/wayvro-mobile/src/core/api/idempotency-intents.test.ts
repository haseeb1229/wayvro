import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../__mocks__/memory-store';
import { STORAGE_KEYS } from '../session/key-value-store';
import { canonicalJson, createIdempotencyIntentStore } from './idempotency-intents';

function keys() {
  let n = 0;
  return () => {
    n += 1;
    return `key_${String(n).padStart(20, '0')}`;
  };
}

describe('idempotency intent store', () => {
  it('keeps the same key for the same intent and request until settled', async () => {
    const store = new MemoryStore();
    const intents = createIdempotencyIntentStore(store, keys());
    const first = await intents.keyFor('consent:TERMS', 'fp1');
    expect(await intents.keyFor('consent:TERMS', 'fp1')).toBe(first);
    await intents.settle('consent:TERMS');
    expect(await intents.keyFor('consent:TERMS', 'fp1')).not.toBe(first);
  });

  it('survives an app restart (persisted in secure storage before use)', async () => {
    const store = new MemoryStore();
    const first = await createIdempotencyIntentStore(store, keys()).keyFor('age-declaration', 'fp');
    expect(store.data.has(STORAGE_KEYS.idempotencyIntents)).toBe(true);
    const afterRestart = createIdempotencyIntentStore(store, () => 'never_used_key_0000000');
    expect(await afterRestart.keyFor('age-declaration', 'fp')).toBe(first);
  });

  it('issues a new key when the request under the same intent changes', async () => {
    const intents = createIdempotencyIntentStore(new MemoryStore(), keys());
    const a = await intents.keyFor('profile-update', 'fpA');
    const b = await intents.keyFor('profile-update', 'fpB');
    expect(b).not.toBe(a);
  });

  it('keeps concurrent intents independent', async () => {
    const intents = createIdempotencyIntentStore(new MemoryStore(), keys());
    const [a, b] = await Promise.all([intents.keyFor('consent:TERMS', 'x'), intents.keyFor('consent:PRIVACY', 'y')]);
    expect(await intents.keyFor('consent:TERMS', 'x')).toBe(a);
    expect(await intents.keyFor('consent:PRIVACY', 'y')).toBe(b);
  });

  it('drops expired and unreadable records, and clears everything on sign-out', async () => {
    const store = new MemoryStore();
    let now = 1_000_000;
    const intents = createIdempotencyIntentStore(store, keys(), () => now);
    const old = await intents.keyFor('a', 'fp');
    now += 25 * 60 * 60 * 1000;
    expect(await intents.keyFor('a', 'fp')).not.toBe(old);

    await store.setItem(STORAGE_KEYS.idempotencyIntents, '{not json');
    expect(await intents.keyFor('b', 'fp')).toMatch(/^key_/);

    await intents.clear();
    expect(store.data.has(STORAGE_KEYS.idempotencyIntents)).toBe(false);
  });

  it('stores only keys and fingerprints, never request bodies', async () => {
    const store = new MemoryStore();
    await createIdempotencyIntentStore(store, keys()).keyFor('otp-challenge', 'deadbeef');
    const raw = store.data.get(STORAGE_KEYS.idempotencyIntents) ?? '';
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(['otp-challenge']);
    expect(raw).not.toMatch(/\+92|phone|token/);
  });

  it('canonical JSON is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
  });
});
