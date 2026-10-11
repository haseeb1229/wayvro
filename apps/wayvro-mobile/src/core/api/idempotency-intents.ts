import { z } from 'zod';
import { STORAGE_KEYS, type KeyValueStore } from '../session/key-value-store';

/**
 * Persisted idempotency keys per user intent (F-03 client side). An intent ("record consent TERMS", "verify this
 * code") keeps the SAME key across retries and app restarts while its outcome is unknown, so a lost response is replayed
 * by the server instead of executed twice. The key is bound to a fingerprint (SHA-256) of the exact request: a
 * different request under the same intent name gets a new key (the server would answer 409 for a reused key with a
 * different body). A definitive server answer settles the intent.
 *
 * Stored in secure storage as one small JSON map; only key material and request hashes — never bodies, tokens or PII.
 * Records older than the server's replay retention are dropped.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RecordsSchema = z.record(z.string(), z.object({ fingerprint: z.string(), key: z.string(), createdAt: z.number() }));
type Records = z.infer<typeof RecordsSchema>;

export interface IdempotencyIntentStore {
  /** Returns the persisted key for (intent, fingerprint), creating and persisting a new one BEFORE it is used. */
  keyFor(intent: string, fingerprint: string): Promise<string>;
  /** Forgets the intent after a definitive outcome. */
  settle(intent: string): Promise<void>;
  /** Removes every intent (sign-out / session expiry). */
  clear(): Promise<void>;
}

export function createIdempotencyIntentStore(store: KeyValueStore, newKey: () => string, now: () => number = Date.now): IdempotencyIntentStore {
  // All reads/writes are serialised so concurrent intents never overwrite each other's records.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const load = async (): Promise<Records> => {
    const raw = await store.getItem(STORAGE_KEYS.idempotencyIntents);
    if (raw === null) return {};
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // Unreadable data is discarded: the worst case is a new key for an in-flight intent (same as a fresh install).
      return {};
    }
    const parsed = RecordsSchema.safeParse(json);
    if (!parsed.success) return {};
    const cutoff = now() - MAX_AGE_MS;
    return Object.fromEntries(Object.entries(parsed.data).filter(([, r]) => r.createdAt >= cutoff));
  };

  const save = (records: Records): Promise<void> =>
    Object.keys(records).length === 0
      ? store.deleteItem(STORAGE_KEYS.idempotencyIntents)
      : store.setItem(STORAGE_KEYS.idempotencyIntents, JSON.stringify(records));

  return {
    keyFor: (intent, fingerprint) =>
      serial(async () => {
        const records = await load();
        const existing = records[intent];
        if (existing?.fingerprint === fingerprint) return existing.key;
        const key = newKey();
        records[intent] = { fingerprint, key, createdAt: now() };
        await save(records);
        return key;
      }),
    settle: (intent) =>
      serial(async () => {
        const records = await load();
        if (!(intent in records)) return;
        await save(Object.fromEntries(Object.entries(records).filter(([name]) => name !== intent)));
      }),
    clear: () => serial(() => store.deleteItem(STORAGE_KEYS.idempotencyIntents)),
  };
}

/** Deterministic JSON (sorted object keys) so equal requests produce equal fingerprints. */
export function canonicalJson(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(canon(value));
}
