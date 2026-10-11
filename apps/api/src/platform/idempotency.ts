/**
 * Persistent idempotency (F-03; docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md §3.6). Records are bound to
 * (actor scope, Idempotency-Key) and store the operation, a SHA-256 hash of the canonical request and the encrypted
 * outcome.
 *
 * The record is inserted PENDING and completed IN THE SAME TRANSACTION as the mutation. A concurrent duplicate therefore
 * blocks on the primary key until the first transaction ends: after a commit it replays the stored outcome, after a
 * rollback it executes itself — exactly one authoritative mutation either way. Same key + different request (or
 * operation) => 409 WAYVRO_E_IDEMPOTENCY_CONFLICT. A handler that throws commits nothing (no record, so a retry
 * re-executes); a handler that returns an error OUTCOME commits its side effects (e.g. a failed OTP attempt) and the
 * error is replayed. Responses may contain tokens, so they are stored as AES-256-GCM envelopes (key class
 * idempotency_responses, AAD bound to the record id). Expired records are ignored and purged by the worker.
 */
import { createHash } from 'node:crypto';
import type { ErrorCode, ErrorDetails } from '@wayvro/contracts';
import type { FieldCipher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { uuidv7, withTransaction } from '@wayvro/server-runtime';
import type pg from 'pg';

export type Outcome =
  | { readonly kind: 'success'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'error'; readonly code: ErrorCode; readonly details?: ErrorDetails | undefined };

export interface IdempotentRequest {
  /** `inst:<sha256 installation id>`, `acct:<account id>` or `sess:<session id>`. */
  readonly scope: string;
  readonly operation: string;
  readonly key: string;
  readonly payload: unknown;
  readonly ttlSeconds: number;
}

export interface IdempotentResult {
  readonly outcome: Outcome;
  readonly replayed: boolean;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function requestHash(operation: string, payload: unknown): Buffer {
  return createHash('sha256')
    .update(`${operation}\n${JSON.stringify(canonical(payload))}`)
    .digest();
}

export const success = (status: number, body: unknown): Outcome => ({ kind: 'success', status, body });
/** A refusal; typed narrowly so helpers can return `Refusal | their own result`. */
export type Refusal = Extract<Outcome, { kind: 'error' }>;
export const failure = (code: ErrorCode, details?: ErrorDetails): Refusal => ({ kind: 'error', code, details });

export class IdempotencyStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly cipher: FieldCipher,
  ) {}

  async execute(request: IdempotentRequest, work: (tx: pg.PoolClient) => Promise<Outcome>): Promise<IdempotentResult> {
    const hash = requestHash(request.operation, request.payload);
    return withTransaction(this.pool, async (tx) => {
      await tx.query(`delete from platform.idempotency_records where actor_scope = $1 and idempotency_key = $2 and expires_at <= now()`, [
        request.scope,
        request.key,
      ]);
      const id = uuidv7();
      const inserted = await tx.query(
        `insert into platform.idempotency_records (id, actor_scope, idempotency_key, operation, request_hash, state, expires_at)
         values ($1, $2, $3, $4, $5, 'PENDING', now() + ($6::int * interval '1 second'))
         on conflict do nothing`,
        [id, request.scope, request.key, request.operation, hash, request.ttlSeconds],
      );
      if (inserted.rowCount === 0) return { outcome: await this.replay(tx, request, hash), replayed: true };
      const outcome = await work(tx);
      const envelope = this.cipher.encrypt('idempotency_responses', JSON.stringify(outcome), fieldContext(ENCRYPTED_FIELDS.idempotencyResponse, id));
      await tx.query(
        `update platform.idempotency_records set state = 'COMPLETED', response_status = $2, response_envelope = $3, expires_at = now() + ($4::int * interval '1 second')
          where id = $1`,
        [id, outcome.kind === 'success' ? outcome.status : new WayvroError(outcome.code).status, envelope, request.ttlSeconds],
      );
      return { outcome, replayed: false };
    });
  }

  private async replay(tx: pg.PoolClient, request: IdempotentRequest, hash: Buffer): Promise<Outcome> {
    const r = await tx.query<{ id: string; operation: string; request_hash: Buffer; state: string; response_envelope: Buffer | null }>(
      `select id, operation, request_hash, state, response_envelope from platform.idempotency_records where actor_scope = $1 and idempotency_key = $2`,
      [request.scope, request.key],
    );
    const row = r.rows[0];
    if (!row || row.operation !== request.operation || !row.request_hash.equals(hash)) throw new WayvroError('WAYVRO_E_IDEMPOTENCY_CONFLICT');
    // A committed PENDING record cannot exist (it is completed in the inserting transaction); fail closed if it ever does.
    if (row.state !== 'COMPLETED' || !row.response_envelope) throw new WayvroError('WAYVRO_E_IDEMPOTENCY_CONFLICT');
    const json = this.cipher.decryptString('idempotency_responses', row.response_envelope, fieldContext(ENCRYPTED_FIELDS.idempotencyResponse, row.id));
    return JSON.parse(json) as Outcome;
  }
}
