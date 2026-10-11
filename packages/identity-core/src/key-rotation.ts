/**
 * Non-destructive key rotation (data model §8.2/§8.3; expand -> migrate -> switch -> contract), progress in
 * `platform.key_rotations`. Operators change key states in the key provider; these engines move the data.
 *
 * FIELD_REENCRYPTION (field keys, e.g. `contact`):
 *   precondition: new version ACTIVE (all new writes use it), old version DECRYPT_ONLY;
 *   BACKFILL: resumable batches ordered by id; each row is decrypted with the key named in its envelope and re-encrypted
 *     with the ACTIVE key through a compare-and-swap on the OLD ENVELOPE BYTES, so a concurrent user write always wins
 *     (counted as skipped). Cursor and counters commit in the same transaction as the batch, so a crash resumes from
 *     the last committed batch. A pass ends with a verification count of envelopes not under the ACTIVE key: zero moves
 *     to RETIRE_PENDING, otherwise another pass starts;
 *   complete: only when the old key is RETIRED in the provider and the verification still counts zero -> DONE.
 * LOOKUP_BACKFILL (phone lookup keys):
 *   precondition: new version ACTIVE, old version DECRYPT_ONLY (both live: every write already dual-writes);
 *   BACKFILL (reads are dual-read): resumable batches insert the new-version row for each phone. A current-owner
 *     uniqueness violation in the new version is a DATA CONFLICT: counted, logged, never skipped silently — the
 *     rotation then stays in BACKFILL as "blocked" until resolved. Zero missing rows and zero conflicts -> READ_SWITCHED;
 *   contract (operator): delete old-version rows -> RETIRE_PENDING; complete when the old key is RETIRED and zero
 *     old-version rows remain -> DONE; abandon (operator, BACKFILL only): delete the partial new-version rows ->
 *     ABANDONED, after which the old version stays authoritative (phone-lookup.ts).
 *   start/contract/abandon/complete take the target's EXCLUSIVE advisory lock before the ledger row lock; lookup writers
 *     hold it SHARED for their whole transaction, so no writer can resurrect rows a contract/abandon deleted.
 * Decryption failures are never tolerated: the batch rolls back and the job retries, then dead-letters (alert).
 */
import type pg from 'pg';
import type { FieldCipher, KeyedHasher, KeyRing } from '@wayvro/field-crypto';
import type { Logger } from '@wayvro/observability';
import { enqueueJob, sqlState, uuidv7, withTransaction, type JobDefinition } from '@wayvro/server-runtime';
import { ENCRYPTED_FIELDS, PHONE_LOOKUP_TARGET, fieldContext, type EncryptedField } from './fields.js';
import { lockRotationTarget } from './phone-lookup.js';

export const KEY_ROTATION_JOB = 'crypto.key-rotation';

interface FieldTarget {
  readonly table: string;
  readonly column: string;
  readonly spec: EncryptedField;
}

/** Field columns that can be re-encrypted (identity core). */
export const FIELD_ROTATION_TARGETS: Readonly<Record<string, FieldTarget>> = {
  [ENCRYPTED_FIELDS.accountPhone.field]: { table: 'identity.account_phones', column: 'phone_envelope', spec: ENCRYPTED_FIELDS.accountPhone },
  [ENCRYPTED_FIELDS.challengePhone.field]: { table: 'identity.otp_challenges', column: 'phone_envelope', spec: ENCRYPTED_FIELDS.challengePhone },
  [ENCRYPTED_FIELDS.phoneChangePhone.field]: {
    table: 'identity.phone_change_requests',
    column: 'new_phone_envelope',
    spec: ENCRYPTED_FIELDS.phoneChangePhone,
  },
};

export class KeyRotationError extends Error {
  override readonly name = 'KeyRotationError';
}

interface RotationRow {
  id: string;
  kind: 'FIELD_REENCRYPTION' | 'LOOKUP_BACKFILL';
  target: string;
  key_class: string;
  from_version: number;
  to_version: number;
  phase: string;
  cursor_id: string | null;
  conflict_count: string;
}

export interface RotationDeps {
  readonly db: pg.Pool;
  readonly ring: KeyRing;
  readonly cipher: FieldCipher;
  readonly hasher: KeyedHasher;
  readonly log: Logger;
  readonly batchSize: number;
}

export type StepOutcome = 'continue' | 'switched' | 'blocked' | 'idle';

function rotationVersions(ring: KeyRing, keyClass: string): { from: number; to: number } {
  const live = ring.live(keyClass);
  const active = ring.active(keyClass);
  const older = live.filter((k) => k.state === 'DECRYPT_ONLY');
  const from = older[0];
  if (!from) throw new KeyRotationError(`key class ${keyClass} has no DECRYPT_ONLY version to rotate away from`);
  if (from.version >= active.version) throw new KeyRotationError(`the ACTIVE ${keyClass} key must be newer than the DECRYPT_ONLY one`);
  return { from: from.version, to: active.version };
}

async function startRotation(deps: RotationDeps, kind: RotationRow['kind'], target: string, keyClass: string): Promise<string> {
  const { from, to } = rotationVersions(deps.ring, keyClass);
  const id = uuidv7();
  await withTransaction(deps.db, async (tx) => {
    if (kind === 'LOOKUP_BACKFILL') {
      // Growing the write set: wait for every in-flight writer that planned under the previous ledger state.
      await lockRotationTarget(tx, target, 'EXCLUSIVE');
      const latest = await tx.query<{ phase: string; from_version: number; to_version: number }>(
        `select phase, from_version, to_version from platform.key_rotations where target = $1 order by started_at desc, id desc limit 1`,
        [target],
      );
      const prev = latest.rows[0];
      if (prev && prev.phase !== 'DONE' && prev.phase !== 'ABANDONED') throw new KeyRotationError(`a rotation of ${target} is already open`);
      const authoritative = prev ? (prev.phase === 'ABANDONED' ? prev.from_version : prev.to_version) : from;
      // The data itself must agree: before a rotation starts, every lookup row is under the authoritative version.
      const present = await tx.query<{ v: number }>(`select distinct lookup_key_version v from identity.phone_lookup_index`);
      const foreign = present.rows.map((r) => r.v).filter((v) => v !== from);
      if (authoritative !== from || foreign.length > 0) {
        throw new KeyRotationError(
          `the rotation must start from the authoritative version v${String(foreign[0] ?? authoritative)} (ring DECRYPT_ONLY is v${String(from)})`,
        );
      }
    }
    try {
      await tx.query(
        `insert into platform.key_rotations (id, kind, target, key_class, from_version, to_version, phase) values ($1, $2, $3, $4, $5, $6, 'BACKFILL')`,
        [id, kind, target, keyClass, from, to],
      );
    } catch (e) {
      if (sqlState(e) === '23505') throw new KeyRotationError(`a rotation of ${target} is already open`, { cause: e });
      throw e;
    }
    await enqueueJob(tx, { type: KEY_ROTATION_JOB, payload: { rotationId: id }, maxAttempts: 5 });
  });
  return id;
}

export async function startFieldRotation(deps: RotationDeps, field: string): Promise<string> {
  const target = FIELD_ROTATION_TARGETS[field];
  if (!target) throw new KeyRotationError(`unknown field rotation target ${field}`);
  return startRotation(deps, 'FIELD_REENCRYPTION', field, target.spec.keyClass);
}

export function startLookupRotation(deps: RotationDeps): Promise<string> {
  return startRotation(deps, 'LOOKUP_BACKFILL', PHONE_LOOKUP_TARGET, 'phone_lookup');
}

/** Processes one batch of an open rotation under a row lock (one runner per rotation at a time). */
export async function runRotationStep(deps: RotationDeps, rotationId: string): Promise<StepOutcome> {
  return withTransaction(deps.db, async (tx) => {
    const r = await tx.query<RotationRow>(`select * from platform.key_rotations where id = $1 for update`, [rotationId]);
    const rotation = r.rows[0];
    if (!rotation) throw new KeyRotationError(`rotation ${rotationId} not found`);
    if (rotation.phase !== 'BACKFILL') return 'idle';
    return rotation.kind === 'FIELD_REENCRYPTION' ? fieldStep(deps, tx, rotation) : lookupStep(deps, tx, rotation);
  });
}

async function fieldStep(deps: RotationDeps, tx: pg.PoolClient, rotation: RotationRow): Promise<StepOutcome> {
  const target = FIELD_ROTATION_TARGETS[rotation.target];
  if (!target) throw new KeyRotationError(`unknown field rotation target ${rotation.target}`);
  const keyClass = target.spec.keyClass;
  const rows = await tx.query<{ id: string; envelope: Buffer }>(
    `select id, ${target.column} envelope from ${target.table} where ${target.column} is not null and ($1::uuid is null or id > $1) order by id limit $2`,
    [rotation.cursor_id, deps.batchSize],
  );
  let rewritten = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    if (!deps.cipher.isStale(keyClass, row.envelope)) continue;
    const ctx = fieldContext(target.spec, row.id);
    const fresh = deps.cipher.encrypt(keyClass, deps.cipher.decrypt(keyClass, row.envelope, ctx), ctx);
    const cas = await tx.query(`update ${target.table} set ${target.column} = $1 where id = $2 and ${target.column} = $3`, [fresh, row.id, row.envelope]);
    if (cas.rowCount === 1) rewritten++;
    else skipped++;
  }
  const last = rows.rows.at(-1)?.id ?? null;
  let phase = 'BACKFILL';
  let cursor = last;
  if (rows.rows.length < deps.batchSize) {
    const remaining = await countStaleEnvelopes(tx, target, deps.ring.active(keyClass).id);
    if (remaining === 0) phase = 'RETIRE_PENDING';
    cursor = null;
  }
  await tx.query(
    `update platform.key_rotations set phase = $2, cursor_id = $3, processed_count = processed_count + $4, rewritten_count = rewritten_count + $5,
            skipped_concurrent_count = skipped_concurrent_count + $6, updated_at = now() where id = $1`,
    [rotation.id, phase, cursor, rows.rows.length, rewritten, skipped],
  );
  return phase === 'RETIRE_PENDING' ? 'switched' : 'continue';
}

async function countStaleEnvelopes(q: pg.PoolClient | pg.Pool, target: FieldTarget, activeKeyId: string): Promise<number> {
  // Key id = bytes [3, 3 + key_id_length) of the envelope (format v1, data model §8.1).
  const r = await q.query<{ n: string }>(
    `select count(*) n from ${target.table} where substring(${target.column} from 4 for get_byte(${target.column}, 2)) <> $1::bytea`,
    [Buffer.from(activeKeyId, 'ascii')],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function lookupStep(deps: RotationDeps, tx: pg.PoolClient, rotation: RotationRow): Promise<StepOutcome> {
  const spec = ENCRYPTED_FIELDS.accountPhone;
  const rows = await tx.query<{ id: string; envelope: Buffer }>(
    `select id, phone_envelope envelope from identity.account_phones where phone_envelope is not null and ($1::uuid is null or id > $1) order by id limit $2`,
    [rotation.cursor_id, deps.batchSize],
  );
  let inserted = 0;
  let conflicts = 0;
  for (const row of rows.rows) {
    const old = await tx.query<{ is_current_owner: boolean }>(
      `select is_current_owner from identity.phone_lookup_index where account_phone_id = $1 and lookup_key_version = $2`,
      [row.id, rotation.from_version],
    );
    const e164 = deps.cipher.decryptString('contact', row.envelope, fieldContext(spec, row.id));
    const digest = deps.hasher.at('phone_lookup', rotation.to_version, e164);
    if (!digest) throw new KeyRotationError(`phone_lookup.v${String(rotation.to_version)} is not live`);
    // A new-version row may already exist (dual-written during BACKFILL). It must carry exactly this digest: a different
    // digest is a data conflict, never silently kept.
    const existing = await tx.query<{ lookup_hash: Buffer }>(
      `select lookup_hash from identity.phone_lookup_index where account_phone_id = $1 and lookup_key_version = $2`,
      [row.id, rotation.to_version],
    );
    const present = existing.rows[0];
    if (present) {
      if (!present.lookup_hash.equals(digest)) {
        conflicts++;
        deps.log.error({ rotationId: rotation.id, accountPhoneId: row.id }, 'lookup rotation data conflict: existing new-version digest does not match');
      }
      continue;
    }
    await tx.query('savepoint lookup_row');
    try {
      const ins = await tx.query(
        `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, $2, $3, $4)`,
        [row.id, rotation.to_version, digest, old.rows[0]?.is_current_owner ?? false],
      );
      inserted += ins.rowCount ?? 0;
      await tx.query('release savepoint lookup_row');
    } catch (e) {
      if (sqlState(e) !== '23505') throw e;
      await tx.query('rollback to savepoint lookup_row');
      conflicts++;
      deps.log.error(
        { rotationId: rotation.id, accountPhoneId: row.id },
        'lookup rotation data conflict: current-owner uniqueness violated in the new version',
      );
    }
  }
  const last = rows.rows.at(-1)?.id ?? null;
  let phase = 'BACKFILL';
  let cursor = last;
  let outcome: StepOutcome = 'continue';
  if (rows.rows.length < deps.batchSize) {
    const missing = await tx.query<{ n: string }>(
      `select count(*) n from identity.account_phones p
        where p.phone_envelope is not null
          and not exists (select 1 from identity.phone_lookup_index l where l.account_phone_id = p.id and l.lookup_key_version = $1)`,
      [rotation.to_version],
    );
    const totalConflicts = Number(rotation.conflict_count) + conflicts;
    if (Number(missing.rows[0]?.n ?? 0) === 0 && totalConflicts === 0) {
      phase = 'READ_SWITCHED';
      outcome = 'switched';
    } else if (totalConflicts > 0) {
      outcome = 'blocked';
    }
    cursor = null;
  }
  await tx.query(
    `update platform.key_rotations set phase = $2, cursor_id = $3, processed_count = processed_count + $4, rewritten_count = rewritten_count + $5,
            conflict_count = conflict_count + $6, updated_at = now() where id = $1`,
    [rotation.id, phase, cursor, rows.rows.length, inserted, conflicts],
  );
  return outcome;
}

/** Operator step after observing READ_SWITCHED: delete old-version lookup rows (contract) -> RETIRE_PENDING. */
export async function contractLookupRotation(deps: RotationDeps, rotationId: string): Promise<number> {
  return withTransaction(deps.db, async (tx) => {
    await lockRotationTarget(tx, PHONE_LOOKUP_TARGET, 'EXCLUSIVE');
    const r = await tx.query<RotationRow>(`select * from platform.key_rotations where id = $1 for update`, [rotationId]);
    const rotation = r.rows[0];
    if (rotation?.kind !== 'LOOKUP_BACKFILL' || rotation.phase !== 'READ_SWITCHED')
      throw new KeyRotationError('contract requires a LOOKUP_BACKFILL rotation in READ_SWITCHED');
    const del = await tx.query(`delete from identity.phone_lookup_index where lookup_key_version = $1`, [rotation.from_version]);
    await tx.query(`update platform.key_rotations set phase = 'RETIRE_PENDING', updated_at = now() where id = $1`, [rotationId]);
    return del.rowCount ?? 0;
  });
}

/** Final step once the old key is RETIRED in the key provider. Re-verifies before marking DONE. */
export async function completeRotation(deps: RotationDeps, rotationId: string): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const target = (await tx.query<{ target: string }>(`select target from platform.key_rotations where id = $1`, [rotationId])).rows[0]?.target;
    if (target === PHONE_LOOKUP_TARGET) await lockRotationTarget(tx, target, 'EXCLUSIVE');
    const r = await tx.query<RotationRow>(`select * from platform.key_rotations where id = $1 for update`, [rotationId]);
    const rotation = r.rows[0];
    if (rotation?.phase !== 'RETIRE_PENDING') throw new KeyRotationError('complete requires a rotation in RETIRE_PENDING');
    if (!deps.ring.isRetired(`${rotation.key_class}.v${String(rotation.from_version)}`)) {
      throw new KeyRotationError(`${rotation.key_class}.v${String(rotation.from_version)} must be RETIRED in the key provider first`);
    }
    if (rotation.kind === 'FIELD_REENCRYPTION') {
      const target = FIELD_ROTATION_TARGETS[rotation.target];
      if (!target || (await countStaleEnvelopes(tx, target, deps.ring.active(rotation.key_class).id)) !== 0) {
        throw new KeyRotationError('envelopes under a non-ACTIVE key remain; rotation cannot complete');
      }
    } else {
      // Fail closed if any old-version lookup row exists (e.g. resurrected or injected after the contract step).
      const old = await tx.query<{ n: string }>(`select count(*) n from identity.phone_lookup_index where lookup_key_version = $1`, [rotation.from_version]);
      if (Number(old.rows[0]?.n ?? 0) !== 0) {
        throw new KeyRotationError(`${old.rows[0]?.n ?? '?'} lookup rows under v${String(rotation.from_version)} remain; rotation cannot complete`);
      }
    }
    await tx.query(`update platform.key_rotations set phase = 'DONE', completed_at = now(), updated_at = now() where id = $1`, [rotationId]);
  });
}

/**
 * Operator abandon of an open rotation. Lookup rotations may only be abandoned in BACKFILL (afterwards reads already
 * depend on the new version); the partial new-version rows are deleted so the old version is again the only one.
 * Field rotations can be abandoned before DONE: envelopes name their key, so reads never depend on the phase.
 */
export async function abandonRotation(deps: RotationDeps, rotationId: string): Promise<number> {
  return withTransaction(deps.db, async (tx) => {
    const target = (await tx.query<{ target: string }>(`select target from platform.key_rotations where id = $1`, [rotationId])).rows[0]?.target;
    if (target === PHONE_LOOKUP_TARGET) await lockRotationTarget(tx, target, 'EXCLUSIVE');
    const r = await tx.query<RotationRow>(`select * from platform.key_rotations where id = $1 for update`, [rotationId]);
    const rotation = r.rows[0];
    if (!rotation || rotation.phase === 'DONE' || rotation.phase === 'ABANDONED') throw new KeyRotationError('abandon requires an open rotation');
    let deleted = 0;
    if (rotation.kind === 'LOOKUP_BACKFILL') {
      if (rotation.phase !== 'BACKFILL') throw new KeyRotationError('a lookup rotation can only be abandoned during BACKFILL');
      deleted = (await tx.query(`delete from identity.phone_lookup_index where lookup_key_version = $1`, [rotation.to_version])).rowCount ?? 0;
    }
    await tx.query(`update platform.key_rotations set phase = 'ABANDONED', completed_at = now(), updated_at = now() where id = $1`, [rotationId]);
    return deleted;
  });
}

/** Job handler: runs batches for up to `budgetMs`, then continues in a new job (resumable, crash-safe). */
export function keyRotationJob(deps: RotationDeps, budgetMs = 10000): JobDefinition {
  return {
    type: KEY_ROTATION_JOB,
    async handler(job) {
      const rotationId = job.payload['rotationId'];
      if (typeof rotationId !== 'string') throw new KeyRotationError('rotationId missing');
      const started = Date.now();
      let outcome: StepOutcome = 'continue';
      while (outcome === 'continue' && Date.now() - started < budgetMs) outcome = await runRotationStep(deps, rotationId);
      if (outcome === 'continue') await enqueueJob(deps.db, { type: KEY_ROTATION_JOB, payload: { rotationId }, maxAttempts: 5 });
      deps.log.info({ rotationId, outcome }, 'key rotation step');
    },
  };
}
