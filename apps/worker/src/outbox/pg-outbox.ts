/**
 * Postgres implementations of the outbox ports (migration 0006): `platform.outbox_events` as the source and
 * `platform.processed_events` as the idempotency record of each consumer.
 *
 * Delivery is AT LEAST ONCE: two relays may pick the same pending event; consumers deduplicate by (consumer, event id),
 * and `markDispatched` only moves PENDING rows. Failures keep an event PENDING with a stable error code until
 * `maxAttempts`, then DEAD (kept for human review, alerted by the relay loop).
 */
import { withTransaction } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ProcessedEventStore } from '../consumer/idempotent-consumer.js';
import type { EventPublisher, OutboxEvent, OutboxSource } from './relay.js';

export class PgOutboxSource implements OutboxSource {
  constructor(private readonly pool: pg.Pool) {}

  async claimBatch(limit: number): Promise<readonly OutboxEvent[]> {
    const r = await this.pool.query<{
      id: string;
      type: string;
      aggregate_type: string;
      aggregate_id: string;
      account_id: string | null;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `select id, type, aggregate_type, aggregate_id, account_id, payload, attempts from platform.outbox_events where status = 'PENDING' order by created_at, id limit $1`,
      [limit],
    );
    return r.rows.map((e) => ({
      eventId: e.id,
      type: e.type,
      aggregateType: e.aggregate_type,
      aggregateId: e.aggregate_id,
      accountId: e.account_id,
      payload: e.payload,
      attempts: e.attempts,
    }));
  }

  async markDispatched(eventIds: readonly string[]): Promise<void> {
    await this.pool.query(`update platform.outbox_events set status = 'DISPATCHED', dispatched_at = now() where id = any($1::uuid[]) and status = 'PENDING'`, [
      [...eventIds],
    ]);
  }

  async markFailed(eventId: string, _reason: string, deadLetter: boolean): Promise<void> {
    // the free-text reason is never stored (it could carry provider text); a stable code is
    await this.pool.query(
      `update platform.outbox_events set attempts = attempts + 1, last_error_code = 'PUBLISH_FAILED', status = case when $2 then 'DEAD' else status end
        where id = $1 and status = 'PENDING'`,
      [eventId, deadLetter],
    );
  }
}

export class PgProcessedEventStore implements ProcessedEventStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Records the event and runs the effect in one transaction: an effect failure rolls the record back (retry). */
  runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean> {
    return withTransaction(this.pool, async (tx) => {
      const inserted = await tx.query(`insert into platform.processed_events (consumer, event_id) values ($1, $2) on conflict do nothing`, [consumer, eventId]);
      if (inserted.rowCount !== 1) return false;
      await effect();
      return true;
    });
  }
}

/** In-process fan-out to the consumers registered for each event type ('*' = every type). */
export class LocalDispatcher implements EventPublisher {
  constructor(
    private readonly consumers: ReadonlyArray<{ readonly types: readonly string[] | '*'; readonly consume: (event: OutboxEvent) => Promise<unknown> }>,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    for (const c of this.consumers) {
      if (c.types === '*' || c.types.includes(event.type)) await c.consume(event);
    }
  }
}
