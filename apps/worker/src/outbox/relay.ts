/**
 * Transactional-outbox relay skeleton (docs/06, docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md §4). Producers write
 * domain events into an outbox table in the SAME transaction as the state change; this relay publishes them
 * at-least-once and marks them dispatched. Consumers deduplicate by `eventId` (see ../consumer/idempotent-consumer.ts).
 *
 * The Postgres `OutboxSource` (./pg-outbox.ts) reads `platform.outbox_events` (migration 0006); the worker runs the relay
 * with an in-process dispatcher whose first consumer is the account-state hint (P2.7).
 */

export interface OutboxEvent {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** The account the event concerns (state-change hints are routed by it), or null. */
  readonly accountId: string | null;
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

// The relay loop's backoff is `backoffDelayMs` from @wayvro/server-runtime (shared with the job runner, ADR-042).
