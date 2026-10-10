/**
 * Idempotent event consumption. Delivery is at-least-once, so every consumer records `(consumer, eventId)` and applies
 * the handler's effects in the same transaction as that record; a redelivered event becomes a no-op.
 * The Postgres-backed store (unique key on consumer + event_id) arrives with the first consumer (Phase 4).
 */

export interface ProcessedEventStore {
  /**
   * Runs `effect` and records the event as processed atomically. Resolves `false` without running `effect` when the
   * event was already processed by this consumer.
   */
  runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean>;
}

export interface ConsumableEvent {
  readonly eventId: string;
  readonly type: string;
}

export type ConsumeOutcome = 'applied' | 'duplicate-ignored';

export function createIdempotentConsumer<E extends ConsumableEvent>(
  consumer: string,
  store: ProcessedEventStore,
  handler: (event: E) => Promise<void>,
): (event: E) => Promise<ConsumeOutcome> {
  if (!/^[a-z][a-z0-9-]*\.v\d+$/.test(consumer)) throw new Error(`consumer name must look like "dispatch-notifier.v1", got "${consumer}"`);
  return async (event) => ((await store.runOnce(consumer, event.eventId, () => handler(event))) ? 'applied' : 'duplicate-ignored');
}
