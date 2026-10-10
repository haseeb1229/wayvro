/**
 * Append-only audit write path (Q39). Rows carry ids and closed-catalogue codes only — never phone numbers, OTPs,
 * tokens, key material or free text — and are written in the same transaction as the state change they record.
 * The database rejects UPDATE/DELETE/TRUNCATE (trigger + INSERT-only grants, migration 0001).
 */
import { currentContext } from '@wayvro/observability';
import type { Queryable } from './sql.js';
import { uuidv7 } from './uuidv7.js';

export type AuditActor = { readonly type: 'ACCOUNT'; readonly id: string } | { readonly type: 'SYSTEM' } | { readonly type: 'ANONYMOUS' };

export interface AuditEvent {
  readonly actor: AuditActor;
  /** UPPER_SNAKE action code, e.g. SESSION_CREATED. */
  readonly action: string;
  /** lower dotted subject type, e.g. identity.session. */
  readonly objectType: string;
  readonly objectId?: string | undefined;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  readonly reasonCode?: string | undefined;
}

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const OBJECT_TYPE = /^[a-z][a-z0-9_.]{1,63}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class AuditEventError extends Error {
  override readonly name = 'AuditEventError';
}

export async function appendAudit(q: Queryable, event: AuditEvent): Promise<string> {
  if (!CODE.test(event.action)) throw new AuditEventError(`invalid audit action ${event.action}`);
  if (!OBJECT_TYPE.test(event.objectType)) throw new AuditEventError(`invalid audit object type ${event.objectType}`);
  if (event.reasonCode !== undefined && !CODE.test(event.reasonCode)) throw new AuditEventError(`invalid audit reason ${event.reasonCode}`);
  const requestId = currentContext()?.requestId;
  const id = uuidv7();
  await q.query(
    `insert into audit.audit_events (id, actor_type, actor_id, action, object_type, object_id, outcome, reason_code, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      event.actor.type,
      event.actor.type === 'ACCOUNT' ? event.actor.id : null,
      event.action,
      event.objectType,
      event.objectId ?? null,
      event.outcome,
      event.reasonCode ?? null,
      requestId !== undefined && REQUEST_ID.test(requestId) ? requestId : null,
    ],
  );
  return id;
}
