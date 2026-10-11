/**
 * First outbox consumer (P2.7): `account-state-hint.v1`. For every event that concerns an account it publishes
 * `{ accountId, cause, eventId }` on the internal hint channel; realtime turns it into `account.state-changed.v1` for
 * that account's own sockets. Idempotent per event id (processed-event record in the same transaction as the publish
 * attempt); a publish failure rolls the record back and the relay retries.
 */
import { ACCOUNT_HINT_CHANNEL } from '@wayvro/server-runtime';
import { createIdempotentConsumer, type ProcessedEventStore } from '../consumer/idempotent-consumer.js';
import type { OutboxEvent } from './relay.js';

export interface HintPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export function accountStateHintConsumer(
  store: ProcessedEventStore,
  redis: HintPublisher,
): { readonly types: '*'; readonly consume: (event: OutboxEvent) => Promise<unknown> } {
  const consume = createIdempotentConsumer<OutboxEvent>('account-state-hint.v1', store, async (event) => {
    if (event.accountId === null) return;
    await redis.publish(ACCOUNT_HINT_CHANNEL, JSON.stringify({ accountId: event.accountId, cause: event.type, eventId: event.eventId }));
  });
  return { types: '*', consume };
}
