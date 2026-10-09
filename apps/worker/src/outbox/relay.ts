/**
 * Transactional-outbox relay skeleton (docs/06, docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md §4). Producers write
 * domain events into an outbox table in the SAME transaction as the state change; this relay publishes them
 * at-least-once and marks them dispatched. Consumers deduplicate by `eventId` (see ../consumer/idempotent-consumer.ts).
 *
 * Phase 1 ships the relay logic behind ports only. The Postgres `OutboxSource` arrives with the outbox table migration
 * together with the first event-producing context (Phase 2/4); until then the worker does not start the relay.
 */

export interface OutboxEvent {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
}

export interface OutboxSource {
  /** Claims up to `limit` undispatched events (implementations use `FOR UPDATE SKIP LOCKED`, ADR-004). */
  claimBatch(limit: number): Promise<readonly OutboxEvent[]>;
  markDispatched(eventIds: readonly string[]): Promise<void>;
  /** Records a failed attempt; `deadLetter` moves the event out of the live queue for human review. */
  markFailed(eventId: string, reason: string, deadLetter: boolean): Promise<void>;
}

export interface EventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export interface RelayOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export interface RelayRunResult {
  readonly claimed: number;
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
}

export class OutboxRelay {
  constructor(
    private readonly source: OutboxSource,
    private readonly publisher: EventPublisher,
    private readonly options: RelayOptions,
  ) {}

  /** One relay pass. Never throws for a single bad event; a source failure propagates to the caller's backoff. */
  async runOnce(): Promise<RelayRunResult> {
    const batch = await this.source.claimBatch(this.options.batchSize);
    const dispatched: string[] = [];
    let failed = 0;
    let deadLettered = 0;
    for (const event of batch) {
      try {
        await this.publisher.publish(event);
        dispatched.push(event.eventId);
      } catch (e) {
        const deadLetter = event.attempts + 1 >= this.options.maxAttempts;
        await this.source.markFailed(event.eventId, e instanceof Error ? e.message : 'publish failed', deadLetter);
        failed++;
        if (deadLetter) deadLettered++;
      }
    }
    if (dispatched.length > 0) await this.source.markDispatched(dispatched);
    return { claimed: batch.length, dispatched: dispatched.length, failed, deadLettered };
  }
}

/** Bounded exponential backoff with full jitter for the relay loop (no retry storms, CLAUDE.md §13). */
export function backoffDelayMs(consecutiveFailures: number, random: () => number = Math.random, baseMs = 250, capMs = 30000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.min(consecutiveFailures, 16));
  return Math.floor(random() * ceiling);
}
