/**
 * Account lifecycle jobs (P2.9; data model §4.2, §4.9; auth design §6.4; U06/K11/K17).
 *
 * `identity.recovery-completion` (every 10 min): a lost-phone recovery whose 72 h cooldown has passed moves the number
 * (the new-number account's phone and the lost number are RELEASED (RECOVERY_MOVED), the recovered account gets the
 * new number, every session of both accounts is revoked); a request whose number is no longer the requester's
 * current phone EXPIRES instead. Open recoveries past their lifetime EXPIRE and their cases are cancelled.
 *
 * `identity.deletion-processing` (hourly): re-evaluates the blockers of every open deletion request (database facts +
 * evidence legal holds in the vault), then processes due requests: evidence is crypto-shredded (wrapped DEK destroyed)
 * and its stored objects deleted, and the account becomes a pseudonymised tombstone (numbers erased, lookups deleted,
 * sessions revoked, open applications/cases/appeals closed). Records named by the request's retention exceptions are
 * kept (placeholder bases until EG-16). Registered only with the vault pool and object storage bound — without them,
 * due requests wait (never "completed" while evidence would remain).
 */
import type { FieldCipher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, deletionBlockers, fieldContext, releasePhone, revokeSessions, type PhoneLookup } from '@wayvro/identity-core';
import type { Logger } from '@wayvro/observability';
import type { ObjectStoragePort } from '@wayvro/provider-interfaces';
import { appendAudit, uuidv7, withTransaction, type JobDefinition, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';

export const RECOVERY_COMPLETION_JOB = 'identity.recovery-completion';
export const DELETION_PROCESSING_JOB = 'identity.deletion-processing';
const BATCH = 20;

async function securityEvent(q: Queryable, accountId: string, type: 'RECOVERY_COMPLETED'): Promise<void> {
  await q.query(`insert into identity.security_events (id, account_id, type) values ($1, $2, $3)`, [uuidv7(), accountId, type]);
}

async function outbox(
  q: Queryable,
  type: string,
  aggregateType: string,
  aggregateId: string,
  accountId: string,
  payload: Record<string, string>,
): Promise<void> {
  await q.query(
    `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status) values ($1, $2, $3, $4, $5, $6, 'PENDING')`,
    [uuidv7(), type, aggregateType, aggregateId, accountId, JSON.stringify(payload)],
  );
}

export function recoveryCompletionJob(deps: { pool: pg.Pool; cipher: FieldCipher; lookup: PhoneLookup; log: Logger }): JobDefinition {
  return {
    type: RECOVERY_COMPLETION_JOB,
    async handler() {
      const expired = await deps.pool.query<{ id: string }>(
        `update identity.phone_change_requests set status = 'EXPIRED', updated_at = now(), version = version + 1
          where kind = 'RECOVERY_DRIVER_KYC' and status = 'MANUAL_REVIEW' and expires_at <= now() returning id`,
      );
      if (expired.rows.length > 0) {
        await deps.pool.query(
          `update compliance.review_cases set status = 'CANCELLED', assigned_staff_id = null, lease_expires_at = null, version = version + 1
            where phone_change_request_id = any($1::uuid[]) and status in ('OPEN', 'CLAIMED', 'ESCALATED')`,
          [expired.rows.map((r) => r.id)],
        );
      }
      let moved = 0;
      let lapsed = 0;
      for (let i = 0; i < BATCH; i++) {
        const outcome = await withTransaction(deps.pool, (tx) => completeOne(tx, deps));
        if (outcome === 'NONE') break;
        if (outcome === 'MOVED') moved++;
        else lapsed++;
      }
      deps.log.info({ job: RECOVERY_COMPLETION_JOB, moved, lapsed, expired: expired.rowCount ?? 0 }, 'recovery completion');
    },
  };
}

async function completeOne(tx: pg.PoolClient, deps: { cipher: FieldCipher; lookup: PhoneLookup }): Promise<'NONE' | 'MOVED' | 'LAPSED'> {
  const r = (
    await tx.query<{ id: string; account_id: string; requested_by_account_id: string; new_phone_envelope: Buffer | null }>(
      `select id, account_id, requested_by_account_id, new_phone_envelope from identity.phone_change_requests
        where kind = 'RECOVERY_DRIVER_KYC' and status = 'COOLDOWN' and cooldown_until <= now()
        order by cooldown_until limit 1 for update skip locked`,
    )
  ).rows[0];
  if (!r) return 'NONE';
  const lapse = async (): Promise<'LAPSED'> => {
    await tx.query(`update identity.phone_change_requests set status = 'EXPIRED', updated_at = now(), version = version + 1 where id = $1`, [r.id]);
    return 'LAPSED';
  };
  if (!r.new_phone_envelope) return lapse();
  const e164 = deps.cipher.decryptString('contact', r.new_phone_envelope, fieldContext(ENCRYPTED_FIELDS.phoneChangePhone, r.id));
  // the number must still be the requester's current phone, and the recovered account must still be ACTIVE
  const owner = await deps.lookup.currentOwner(tx, e164);
  const target = await tx.query(`select 1 from identity.accounts where id = $1 and status = 'ACTIVE'`, [r.account_id]);
  if (owner?.accountId !== r.requested_by_account_id || (target.rowCount ?? 0) === 0) return lapse();
  await releasePhone(tx, owner.accountPhoneId, 'RECOVERY_MOVED');
  await revokeSessions(tx, r.requested_by_account_id, 'RECOVERY', null);
  const lost = (await tx.query<{ id: string }>(`select id from identity.account_phones where account_id = $1 and status = 'VERIFIED'`, [r.account_id])).rows[0];
  if (lost) await releasePhone(tx, lost.id, 'RECOVERY_MOVED');
  const phoneId = uuidv7();
  await tx.query(
    `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
    [phoneId, r.account_id, deps.cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.accountPhone, phoneId)), e164.slice(-4)],
  );
  await deps.lookup.writeCurrentOwner(tx, phoneId, e164);
  await revokeSessions(tx, r.account_id, 'RECOVERY', null);
  await tx.query(
    `update identity.phone_change_requests set status = 'COMPLETED', completed_at = now(), updated_at = now(), version = version + 1 where id = $1`,
    [r.id],
  );
  await securityEvent(tx, r.account_id, 'RECOVERY_COMPLETED');
  for (const account of [r.account_id, r.requested_by_account_id]) {
    await outbox(tx, 'account.phone.changed.v1', 'identity.account', account, account, {});
  }
  await appendAudit(tx, {
    actor: { type: 'SYSTEM' },
    action: 'ACCOUNT_RECOVERY_COMPLETED',
    objectType: 'identity.phone_change_request',
    objectId: r.id,
    outcome: 'SUCCESS',
  });
  return 'MOVED';
}

// ── deletion ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DeletionJobDeps {
  readonly pool: pg.Pool;
  readonly vault: pg.Pool;
  readonly storage: ObjectStoragePort;
  readonly log: Logger;
}

export function deletionProcessingJob(deps: DeletionJobDeps): JobDefinition {
  return {
    type: DELETION_PROCESSING_JOB,
    async handler() {
      const open = await deps.pool.query<{ id: string; account_id: string }>(
        `select id, account_id from identity.account_deletion_requests where status in ('GRACE', 'BLOCKED') order by grace_until limit 500`,
      );
      let blocked = 0;
      for (const r of open.rows) {
        if (await reevaluate(deps, r.id, r.account_id)) blocked++;
      }
      const due = await deps.pool.query<{ id: string; account_id: string }>(
        `update identity.account_deletion_requests set status = 'PROCESSING', updated_at = now(), version = version + 1
          where id in (select id from identity.account_deletion_requests where status = 'GRACE' and grace_until <= now() order by grace_until limit $1)
          returning id, account_id`,
        [BATCH],
      );
      // PROCESSING requests left by an earlier interrupted run are finished too (every step is idempotent)
      const resumed = await deps.pool.query<{ id: string; account_id: string }>(
        `select id, account_id from identity.account_deletion_requests where status = 'PROCESSING' and not (id = any($1::uuid[])) limit $2`,
        [due.rows.map((r) => r.id), BATCH],
      );
      let completed = 0;
      for (const r of [...due.rows, ...resumed.rows]) {
        await eraseEvidence(deps, r.account_id);
        await withTransaction(deps.pool, (tx) => pseudonymise(tx, r.id, r.account_id));
        completed++;
      }
      deps.log.info({ job: DELETION_PROCESSING_JOB, reevaluated: open.rowCount ?? 0, blocked, completed }, 'account deletion');
    },
  };
}

/** Recomputes the blockers of one open request; returns true when it stays/becomes BLOCKED. */
async function reevaluate(deps: DeletionJobDeps, requestId: string, accountId: string): Promise<boolean> {
  const held = await deps.vault.query(`select 1 from vault.evidence_objects where owner_account_id = $1 and legal_hold limit 1`, [accountId]);
  return withTransaction(deps.pool, async (tx) => {
    const blockers = new Set<string>(await deletionBlockers(tx, accountId));
    if ((held.rowCount ?? 0) > 0) blockers.add('LEGAL_HOLD');
    await tx.query(
      `update identity.deletion_request_blockers set cleared_at = now() where deletion_request_id = $1 and cleared_at is null and not (blocker_code = any($2::text[]))`,
      [requestId, [...blockers]],
    );
    for (const b of blockers) {
      await tx.query(
        `insert into identity.deletion_request_blockers (id, deletion_request_id, blocker_code)
         select $1, $2, $3 where not exists (select 1 from identity.deletion_request_blockers where deletion_request_id = $2 and blocker_code = $3 and cleared_at is null)`,
        [uuidv7(), requestId, b],
      );
    }
    await tx.query(
      `update identity.account_deletion_requests set status = $2, updated_at = now(), version = version + 1 where id = $1 and status in ('GRACE', 'BLOCKED') and status <> $2`,
      [requestId, blockers.size > 0 ? 'BLOCKED' : 'GRACE'],
    );
    return blockers.size > 0;
  });
}

/** K11: crypto-shreds and deletes the account's evidence (legal holds were checked before PROCESSING). */
async function eraseEvidence(deps: DeletionJobDeps, accountId: string): Promise<void> {
  const rows = await withTransaction(deps.vault, async (vtx) => {
    await vtx.query(
      `update vault.evidence_objects set status = 'DISCARDED', wrapped_dek = null, version = version + 1
        where owner_account_id = $1 and not legal_hold and (status <> 'DISCARDED' or wrapped_dek is not null)`,
      [accountId],
    );
    const keys = await vtx.query<{ id: string; quarantine_key: string; vault_key: string | null }>(
      `select id, quarantine_key, vault_key from vault.evidence_objects where owner_account_id = $1 and not legal_hold`,
      [accountId],
    );
    if (keys.rows.length > 0) {
      await appendAudit(vtx, {
        actor: { type: 'SYSTEM' },
        action: 'EVIDENCE_ERASED_ON_DELETION',
        objectType: 'identity.account',
        objectId: accountId,
        outcome: 'SUCCESS',
      });
    }
    return keys.rows;
  });
  for (const r of rows) {
    await deps.storage.deleteObject({ area: 'quarantine', key: r.quarantine_key });
    if (r.vault_key) await deps.storage.deleteObject({ area: 'vault', key: r.vault_key });
  }
}

async function pseudonymise(tx: pg.PoolClient, requestId: string, accountId: string): Promise<void> {
  const current = await tx.query<{ status: string }>(`select status from identity.account_deletion_requests where id = $1 for update`, [requestId]);
  if (current.rows[0]?.status !== 'PROCESSING') return;
  await revokeSessions(tx, accountId, 'ACCOUNT_DELETED', null);
  const phones = await tx.query<{ id: string }>(`select id from identity.account_phones where account_id = $1`, [accountId]);
  for (const p of phones.rows) await releasePhone(tx, p.id, 'ACCOUNT_DELETED');
  await tx.query(`delete from identity.phone_lookup_index where account_phone_id = any($1::uuid[])`, [phones.rows.map((p) => p.id)]);
  await tx.query(
    `update identity.account_phones set release_reason = 'ACCOUNT_DELETED', released_at = coalesce(released_at, now()), phone_envelope = null, phone_last4 = null
      where account_id = $1`,
    [accountId],
  );
  // change/recovery requests naming the account (as owner or as the new-number requester): closed, numbers erased
  await tx.query(
    `update identity.phone_change_requests set status = case when status in ('CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN') then 'CANCELLED' else status end,
            new_phone_envelope = null, new_phone_last4 = null, new_phone_lookup_version = null, new_phone_lookup_hash = null, updated_at = now(), version = version + 1
      where account_id = $1 or requested_by_account_id = $1`,
    [accountId],
  );
  // open driver work is closed by the system (the person asked for deletion); decisions and reason codes are kept
  await tx.query(
    `update compliance.driver_applications set state = 'WITHDRAWN', updated_at = now(), version = version + 1
      where account_id = $1 and state not in ('VERIFIED', 'REJECTED_FINAL', 'WITHDRAWN', 'EXPIRED_DRAFT', 'REJECTED')`,
    [accountId],
  );
  await tx.query(
    `update compliance.review_cases c set status = 'CANCELLED', assigned_staff_id = null, lease_expires_at = null, version = c.version + 1
      where c.status in ('OPEN', 'CLAIMED', 'ESCALATED')
        and (c.driver_application_id in (select id from compliance.driver_applications where account_id = $1)
          or c.driver_profile_id in (select id from compliance.driver_profiles where account_id = $1))`,
    [accountId],
  );
  await tx.query(`update profile.appeals set status = 'WITHDRAWN', version = version + 1 where account_id = $1 and status in ('SUBMITTED', 'UNDER_REVIEW')`, [
    accountId,
  ]);
  await tx.query(`update identity.accounts set status = 'DELETED', deleted_at = now(), display_name = null, version = version + 1 where id = $1`, [accountId]);
  await tx.query(
    `update identity.account_deletion_requests set status = 'COMPLETED', completed_at = now(), updated_at = now(), version = version + 1 where id = $1`,
    [requestId],
  );
  await appendAudit(tx, {
    actor: { type: 'SYSTEM' },
    action: 'ACCOUNT_DELETED',
    objectType: 'identity.account_deletion_request',
    objectId: requestId,
    outcome: 'SUCCESS',
  });
}
