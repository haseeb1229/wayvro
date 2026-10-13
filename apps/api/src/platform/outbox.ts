/**
 * Transactional outbox (ADR-004/ADR-042; API doc §3): an event row is written in the SAME transaction as the state
 * change it describes; the worker relay dispatches it at least once. Payloads carry ids and closed-catalogue codes only
 * — never names, numbers, phone numbers, statements or evidence.
 */
import { uuidv7, type Queryable } from '@wayvro/server-runtime';

type OutboxEventType =
  | 'driver.application.submitted.v1'
  | 'driver.application.decided.v1'
  | 'driver.approved.v1'
  | 'driver.document.decided.v1'
  | 'restriction.changed.v1'
  | 'account.phone.changed.v1'
  | 'account.recovery.requested.v1'
  | 'account.recovery.decided.v1'
  | 'account.deletion.changed.v1'
  | 'appeal.decided.v1'
  // Phase 3 catalog (P3.1): configuration changes riders/drivers observe (ids and codes only, no account)
  | 'catalog.zone-set.activated.v1'
  | 'catalog.zone-set.retired.v1'
  | 'catalog.eligibility-rule.activated.v1'
  | 'catalog.eligibility-rule.retired.v1'
  | 'catalog.city-product.changed.v1'
  // Phase 3 release controls (P3.4): ids and codes only
  | 'platform.runtime-switch.changed.v1'
  | 'platform.app-policy.activated.v1'
  // Phase 3 pricing (P3.3): a rate card became ACTIVE (ids, codes and versions only)
  | 'pricing.rate-card.activated.v1';

export interface OutboxEventInput {
  readonly type: OutboxEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** The account the event concerns (routes state-change hints); null for events without an account. */
  readonly accountId: string | null;
  readonly payload?: Readonly<Record<string, string | number | boolean | readonly string[] | null>>;
}

export async function emitEvent(q: Queryable, event: OutboxEventInput): Promise<string> {
  const id = uuidv7();
  await q.query(
    `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status) values ($1, $2, $3, $4, $5, $6, 'PENDING')`,
    [id, event.type, event.aggregateType, event.aggregateId, event.accountId, JSON.stringify(event.payload ?? {})],
  );
  return id;
}
