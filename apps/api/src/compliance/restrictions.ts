/**
 * Restriction reads (V13). Restrictions attach to SERVER ids (account, driver profile, vehicle, capability,
 * city+category), so logout/login, reinstall, device change and any client mode header read the same rows.
 * Effects are derived from (scope, reason class) in `eligibility.ts`; nothing is stored per client.
 */
import type { Queryable } from '@wayvro/server-runtime';
import { blocksRiderUse, inForce, type ReasonClass, type RestrictionFact, type RestrictionScope } from './eligibility.js';

export interface RestrictionRow extends RestrictionFact {
  readonly id: string;
  readonly accountId: string | null;
  readonly reasonCode: string;
  readonly appealable: boolean;
  readonly createdByStaff: boolean;
}

interface Row {
  id: string;
  scope: RestrictionScope;
  account_id: string | null;
  driver_profile_id: string | null;
  vehicle_id: string | null;
  service_capability_id: string | null;
  city_code: string | null;
  service_category: string | null;
  reason_code: string;
  reason_class: ReasonClass;
  status: RestrictionFact['status'];
  appealable: boolean;
  effective_from: Date;
  effective_until: Date | null;
  created_by_staff_id: string | null;
}

export function toRestriction(r: Row): RestrictionRow {
  return {
    id: r.id,
    scope: r.scope,
    accountId: r.account_id,
    driverProfileId: r.driver_profile_id,
    vehicleId: r.vehicle_id,
    serviceCapabilityId: r.service_capability_id,
    cityCode: r.city_code,
    serviceCategory: r.service_category,
    reasonCode: r.reason_code,
    reasonClass: r.reason_class,
    status: r.status,
    appealable: r.appealable,
    effectiveFrom: r.effective_from,
    effectiveUntil: r.effective_until,
    createdByStaff: r.created_by_staff_id !== null,
  };
}

/** Every not-yet-finished restriction on the account, its driver profile, its capabilities and its affiliated vehicles. */
export async function restrictionsForAccount(q: Queryable, accountId: string): Promise<RestrictionRow[]> {
  const r = await q.query<Row>(
    `with profile as (select id from compliance.driver_profiles where account_id = $1),
          vehicles as (
            select va.vehicle_id from compliance.vehicle_affiliations va
              left join compliance.driver_applications a on a.id = va.driver_application_id
             where va.status <> 'ENDED' and (a.account_id = $1 or va.driver_profile_id in (select id from profile)))
     select r.* from profile.restrictions r
      where r.status in ('ACTIVE', 'LIFT_PENDING_APPROVAL')
        and (r.account_id = $1
          or r.driver_profile_id in (select id from profile)
          or r.vehicle_id in (select vehicle_id from vehicles)
          or r.service_capability_id in (select c.id from compliance.service_capabilities c where c.driver_profile_id in (select id from profile)))
      order by r.created_at`,
    [accountId],
  );
  return r.rows.map(toRestriction);
}

/** In-force ACCOUNT-scope restrictions (the only ones that affect passenger use and consumer routes). */
export async function accountRestrictionsInForce(q: Queryable, accountId: string, now: Date): Promise<RestrictionRow[]> {
  const r = await q.query<Row>(
    `select * from profile.restrictions where account_id = $1 and scope = 'ACCOUNT' and status in ('ACTIVE', 'LIFT_PENDING_APPROVAL')`,
    [accountId],
  );
  return r.rows.map(toRestriction).filter((x) => inForce(x, now));
}

/** The account holder's view of their restrictions (codes only; localised by the client). */
export function accountView(r: RestrictionRow): {
  id: string;
  scope: RestrictionScope;
  reasonCode: string;
  reasonClass: ReasonClass;
  appealable: boolean;
  effectiveUntil: string | null;
  affectsRiderUse: boolean;
} {
  const now = new Date();
  return {
    id: r.id,
    scope: r.scope,
    reasonCode: r.reasonCode,
    reasonClass: r.reasonClass,
    appealable: r.appealable,
    effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    affectsRiderUse: blocksRiderUse(r, now),
  };
}
