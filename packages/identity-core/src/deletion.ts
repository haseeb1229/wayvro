/**
 * Account deletion rules shared by the API (request time) and the worker (re-evaluation and processing) — U06; data
 * model §4.9. Blockers stop processing while they are open; retention exceptions name the data kept after deletion
 * and its basis. The bases are PLACEHOLDERS until the retention schedule clears legal review (EG-16).
 */
import type { Queryable } from '@wayvro/server-runtime';

export type DeletionBlocker = 'LEGAL_HOLD' | 'RECOVERY_IN_PROGRESS' | 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION';

/** Open blockers of the account (database facts only; evidence legal holds are added by the worker from the vault). */
export async function deletionBlockers(q: Queryable, accountId: string): Promise<DeletionBlocker[]> {
  const r = await q.query<{ legal: boolean; recovery: boolean; investigation: boolean }>(
    `with subjects as (
       select r.reason_class from profile.restrictions r
        where r.status in ('ACTIVE', 'LIFT_PENDING_APPROVAL') and (r.effective_until is null or r.effective_until > now())
          and (r.account_id = $1 or r.driver_profile_id in (select p.id from compliance.driver_profiles p where p.account_id = $1)))
     select exists (select 1 from subjects where reason_class = 'LEGAL') legal,
            exists (select 1 from identity.phone_change_requests c
                     where c.status in ('MANUAL_REVIEW', 'COOLDOWN') and (c.account_id = $1 or c.requested_by_account_id = $1)) recovery,
            exists (select 1 from subjects where reason_class in ('SAFETY', 'FRAUD')) investigation`,
    [accountId],
  );
  const row = r.rows[0];
  const out: DeletionBlocker[] = [];
  if (row?.legal) out.push('LEGAL_HOLD');
  if (row?.recovery) out.push('RECOVERY_IN_PROGRESS');
  if (row?.investigation) out.push('OPEN_SAFETY_OR_FRAUD_INVESTIGATION');
  return out;
}

const PENDING = 'retention period pending legal review (EG-16)';

/** Data kept after deletion and why. Evidence images are NOT kept (erased unless under a legal hold). */
export async function retentionExceptions(q: Queryable, accountId: string): Promise<Array<{ dataCategory: string; basisRef: string }>> {
  const driver = await q.query(`select 1 from compliance.driver_applications where account_id = $1`, [accountId]);
  const kept = [
    { dataCategory: 'SECURITY_AND_AUDIT_RECORDS', basisRef: `Audit trail and security events (Q39); ${PENDING}` },
    { dataCategory: 'CONSENT_AND_AGE_RECORDS', basisRef: `Proof of policy acceptance and age declarations; ${PENDING}` },
  ];
  if ((driver.rowCount ?? 0) > 0) {
    kept.push(
      { dataCategory: 'DRIVER_REVIEW_DECISIONS', basisRef: `Review decisions and reason codes (fraud and safety); ${PENDING}` },
      { dataCategory: 'DRIVER_IDENTITY_RECORDS', basisRef: `Driver name, date of birth, CNIC and keyed duplicate-detection hashes; ${PENDING}` },
    );
  }
  return kept;
}
