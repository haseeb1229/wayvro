import type { KeyValueStore } from '../core/session/key-value-store';

/** In-memory KeyValueStore for unit tests, with an operation log to assert ordering (e.g. persist-before-release). */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  readonly log: string[] = [];

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    this.log.push(`set:${key}`);
    return Promise.resolve();
  }

  deleteItem(key: string): Promise<void> {
    this.data.delete(key);
    this.log.push(`delete:${key}`);
    return Promise.resolve();
  }
}

/** Deterministic "random" bytes: an incrementing counter (tests only; never a CSPRNG). */
export function counterBytes(start = 1): (n: number) => Uint8Array {
  let next = start;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (next + i) % 256;
    next += 1;
    return out;
  };
}
