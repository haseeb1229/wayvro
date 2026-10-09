import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createIdempotentConsumer, type ProcessedEventStore } from '../src/consumer/idempotent-consumer.js';
import { OutboxRelay, backoffDelayMs, type EventPublisher, type OutboxEvent, type OutboxSource } from '../src/outbox/relay.js';
import { loadWorkerConfig } from '../src/config.js';

/** Test double of the outbox table: claim/dispatch/fail semantics only. */
class MemoryOutbox implements OutboxSource {
  readonly dispatched = new Set<string>();
  readonly deadLetters = new Set<string>();
  readonly failures: Array<{ eventId: string; reason: string }> = [];
  constructor(private readonly events: OutboxEvent[]) {}
  claimBatch(limit: number): Promise<readonly OutboxEvent[]> {
    return Promise.resolve(this.events.filter((e) => !this.dispatched.has(e.eventId) && !this.deadLetters.has(e.eventId)).slice(0, limit));
  }
  markDispatched(ids: readonly string[]): Promise<void> {
    ids.forEach((id) => this.dispatched.add(id));
    return Promise.resolve();
  }
  markFailed(eventId: string, reason: string, deadLetter: boolean): Promise<void> {
    this.failures.push({ eventId, reason });
    const e = this.events.find((x) => x.eventId === eventId);
    if (e) this.events[this.events.indexOf(e)] = { ...e, attempts: e.attempts + 1 };
    if (deadLetter) this.deadLetters.add(eventId);
    return Promise.resolve();
  }
}

/** Test double of the processed-events table (unique consumer+eventId). */
class MemoryProcessedStore implements ProcessedEventStore {
  private readonly seen = new Set<string>();
  async runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean> {
    const key = `${consumer}:${eventId}`;
    if (this.seen.has(key)) return false;
    await effect(); // a real store runs the effect and the insert in one transaction
    this.seen.add(key);
    return true;
  }
}

const event = (n: number, attempts = 0): OutboxEvent => ({
  eventId: `evt-${String(n)}`,
  type: 'platform.probe.v1',
  aggregateId: `agg-${String(n)}`,
  payload: { n },
  attempts,
});

describe('OutboxRelay', () => {
  it('publishes a batch and marks it dispatched', async () => {
    const outbox = new MemoryOutbox([event(1), event(2), event(3)]);
    const published: string[] = [];
    const relay = new OutboxRelay(outbox, { publish: (e) => Promise.resolve(void published.push(e.eventId)) }, { batchSize: 2, maxAttempts: 3 });
    expect(await relay.runOnce()).toEqual({ claimed: 2, dispatched: 2, failed: 0, deadLettered: 0 });
    expect(await relay.runOnce()).toEqual({ claimed: 1, dispatched: 1, failed: 0, deadLettered: 0 });
    expect(await relay.runOnce()).toEqual({ claimed: 0, dispatched: 0, failed: 0, deadLettered: 0 });
    expect(published).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('keeps failing events for retry and dead-letters them after maxAttempts without blocking others', async () => {
    const outbox = new MemoryOutbox([event(1), event(2)]);
    const flaky: EventPublisher = { publish: (e) => (e.eventId === 'evt-1' ? Promise.reject(new Error('broker down')) : Promise.resolve()) };
    const relay = new OutboxRelay(outbox, flaky, { batchSize: 10, maxAttempts: 2 });
    expect(await relay.runOnce()).toEqual({ claimed: 2, dispatched: 1, failed: 1, deadLettered: 0 });
    expect(await relay.runOnce()).toEqual({ claimed: 1, dispatched: 0, failed: 1, deadLettered: 1 });
    expect(await relay.runOnce()).toEqual({ claimed: 0, dispatched: 0, failed: 0, deadLettered: 0 });
    expect(outbox.deadLetters).toEqual(new Set(['evt-1']));
    expect(outbox.failures.map((f) => f.reason)).toEqual(['broker down', 'broker down']);
  });

  it('propagates a source failure so the loop can back off', async () => {
    const broken: OutboxSource = {
      claimBatch: () => Promise.reject(new Error('db down')),
      markDispatched: () => Promise.resolve(),
      markFailed: () => Promise.resolve(),
    };
    await expect(new OutboxRelay(broken, { publish: () => Promise.resolve() }, { batchSize: 1, maxAttempts: 1 }).runOnce()).rejects.toThrow('db down');
  });

  it('backoff is bounded, non-negative and grows with failures (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.double({ min: 0, max: 0.999999, noNaN: true }), (n, r) => {
        const d = backoffDelayMs(n, () => r);
        return d >= 0 && d <= 30000 && d <= 250 * 2 ** Math.min(n, 16);
      }),
    );
    expect(backoffDelayMs(0, () => 0.999)).toBeLessThan(250);
    expect(backoffDelayMs(50, () => 0.999)).toBeLessThanOrEqual(30000);
  });
});

describe('idempotent consumer', () => {
  it('applies an event once and ignores redeliveries', async () => {
    const store = new MemoryProcessedStore();
    const applied: string[] = [];
    const consume = createIdempotentConsumer('probe-consumer.v1', store, (e: { eventId: string; type: string }) =>
      Promise.resolve(void applied.push(e.eventId)),
    );
    const e = { eventId: 'evt-1', type: 'platform.probe.v1' };
    expect(await consume(e)).toBe('applied');
    expect(await consume(e)).toBe('duplicate-ignored');
    expect(await consume({ ...e, eventId: 'evt-2' })).toBe('applied');
    expect(applied).toEqual(['evt-1', 'evt-2']);
  });

  it('does not record an event whose handler failed, so redelivery retries it', async () => {
    const store = new MemoryProcessedStore();
    let calls = 0;
    const consume = createIdempotentConsumer('probe-consumer.v1', store, () => (++calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve()));
    const e = { eventId: 'evt-9', type: 'platform.probe.v1' };
    await expect(consume(e)).rejects.toThrow('transient');
    expect(await consume(e)).toBe('applied');
    expect(await consume(e)).toBe('duplicate-ignored');
  });

  it('isolates consumers: the same event is applied once per consumer', async () => {
    const store = new MemoryProcessedStore();
    const noop = () => Promise.resolve();
    const e = { eventId: 'evt-1', type: 'platform.probe.v1' };
    expect(await createIdempotentConsumer('a-consumer.v1', store, noop)(e)).toBe('applied');
    expect(await createIdempotentConsumer('b-consumer.v1', store, noop)(e)).toBe('applied');
  });

  it('rejects unversioned consumer names', () => {
    expect(() => createIdempotentConsumer('Consumer', new MemoryProcessedStore(), () => Promise.resolve())).toThrow(/consumer name/);
  });
});

describe('worker configuration', () => {
  it('defaults the health endpoint to loopback and requires its dependencies', () => {
    expect(loadWorkerConfig({ WAYVRO_ENV: 'local', DATABASE_URL: 'postgres://a:b@127.0.0.1:25432/w', REDIS_URL: 'redis://127.0.0.1:26379' })).toMatchObject({
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: 4002,
    });
    expect(() => loadWorkerConfig({ WAYVRO_ENV: 'local' })).toThrow(/DATABASE_URL/);
  });
});
