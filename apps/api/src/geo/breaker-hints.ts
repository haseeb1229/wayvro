/**
 * Shared circuit-breaker hint in Valkey: `<prefix>breaker:<providerKey>:<sku>` = OPEN-until (epoch ms), expiring with
 * the open period (docs/phase3/PHASE3_ARCHITECTURE.md §5.4). A HINT only — the process-local breaker enforces on its
 * own when Valkey is unavailable (errors propagate to the breaker, which reports them and carries on).
 */
import type { BreakerHintStore, BreakerKey, ValkeyClient as Redis } from '@wayvro/server-runtime';

export class ValkeyBreakerHints implements BreakerHintStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly now: () => number = Date.now,
  ) {}

  private key(k: BreakerKey): string {
    return `${this.prefix}breaker:${k.providerKey}:${k.sku}`;
  }

  async readOpenUntil(k: BreakerKey): Promise<number | null> {
    const v = await this.redis.get(this.key(k));
    if (v === null) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }

  async writeOpenUntil(k: BreakerKey, openUntilMs: number): Promise<void> {
    const ttl = Math.max(1, openUntilMs - this.now());
    await this.redis.set(this.key(k), String(openUntilMs), 'PX', ttl);
  }
}
