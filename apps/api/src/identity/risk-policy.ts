/**
 * System-created restrictions and the driver risk policy (auth design §5–§6; founder Q-14; K17/S12/D27 inputs).
 *
 * Earning is temporarily held ONLY when a risk trigger fires — never as a blanket device-change rule: a reason-coded,
 * appealable, auto-expiring `DRIVER_ROLE` restriction with `reason_class = RISK_HOLD`, plus one REVERIFICATION review
 * case for a human to clear or confirm it. Rider-mode use is unaffected (DRIVER_ROLE scope). Real selfie re-checks
 * stay behind the DPIA gate (EG-10); the case is decided by a reviewer on the evidence already held, or in person.
 */
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import { emitEvent } from '../platform/outbox.js';

/** Risk triggers wired in Phase 2 (a trigger alone never decides anything beyond the temporary hold). */
export type RiskTrigger = 'PHONE_CHANGED' | 'DEVICE_VELOCITY';

const RISK_HOLD_HOURS = 72;
/** Distinct installations first verified within the window that make a driver's sign-ins a velocity signal. */
export const DEVICE_VELOCITY = { devices: 3, days: 7 } as const;

export async function createSystemRestriction(
  tx: Queryable,
  input: {
    scope: 'ACCOUNT' | 'DRIVER_ROLE';
    subjectId: string;
    reasonClass: 'SECURITY_HOLD' | 'RISK_HOLD';
    reasonCode: string;
    system: string;
    effectiveHours: number | null;
    accountId: string;
  },
): Promise<string> {
  const id = uuidv7();
  await tx.query(
    `insert into profile.restrictions (id, scope, account_id, driver_profile_id, reason_code, reason_class, status, effective_until, appealable, created_by_system)
     values ($1, $2, $3, $4, $5, $6, 'ACTIVE', case when $7::int is null then null else now() + ($7::int * interval '1 hour') end, true, $8)`,
    [
      id,
      input.scope,
      input.scope === 'ACCOUNT' ? input.subjectId : null,
      input.scope === 'DRIVER_ROLE' ? input.subjectId : null,
      input.reasonCode,
      input.reasonClass,
      input.effectiveHours,
      input.system,
    ],
  );
  await tx.query(`insert into profile.restriction_events (id, restriction_id, event, actor_system, reason_code) values ($1, $2, 'CREATED', $3, $4)`, [
    uuidv7(),
    id,
    input.system,
    input.reasonCode,
  ]);
  await emitEvent(tx, {
    type: 'restriction.changed.v1',
    aggregateType: 'profile.restriction',
    aggregateId: id,
    accountId: input.accountId,
    payload: { status: 'ACTIVE' },
  });
  await appendAudit(tx, {
    actor: { type: 'SYSTEM' },
    action: 'RESTRICTION_CREATED',
    objectType: 'profile.restriction',
    objectId: id,
    outcome: 'SUCCESS',
    reasonCode: input.reasonCode,
  });
  return id;
}

/**
 * Applies the driver risk policy for `trigger`: no-op for an account without a driver profile or with a RISK_HOLD
 * already in force; otherwise the temporary hold and (if none is open) a REVERIFICATION case. Returns the hold id.
 */
export async function applyDriverRiskHold(tx: Queryable, accountId: string, trigger: RiskTrigger): Promise<string | null> {
  const profile = (
    await tx.query<{ id: string; city_code: string }>(
      `select p.id, a.city_code from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
      [accountId],
    )
  ).rows[0];
  if (!profile) return null;
  const held = await tx.query(
    `select 1 from profile.restrictions where driver_profile_id = $1 and reason_class = 'RISK_HOLD' and status = 'ACTIVE' and effective_until > now()`,
    [profile.id],
  );
  if ((held.rowCount ?? 0) > 0) return null;
  const hold = await createSystemRestriction(tx, {
    scope: 'DRIVER_ROLE',
    subjectId: profile.id,
    reasonClass: 'RISK_HOLD',
    reasonCode: `RISK_${trigger}`,
    system: 'risk-policy',
    effectiveHours: RISK_HOLD_HOURS,
    accountId,
  });
  await tx.query(
    `insert into compliance.review_cases (id, kind, driver_profile_id, city_code, priority, status)
     select $1, 'REVERIFICATION', $2, $3, 2, 'OPEN'
      where not exists (select 1 from compliance.review_cases where driver_profile_id = $2 and kind = 'REVERIFICATION' and status in ('OPEN', 'CLAIMED', 'ESCALATED'))`,
    [uuidv7(), profile.id, profile.city_code],
  );
  return hold;
}
