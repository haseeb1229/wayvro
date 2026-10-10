/**
 * Age-eligibility policy (A15). Thresholds and the declaration mode are POLICY DATA in `legal.age_eligibility_policies`
 * (server time decides the current version); no threshold exists in code.
 */
import { WayvroError } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';

type DeclarationMode = 'NONE' | 'AFFIRM_MINIMUM_AGE' | 'DATE_OF_BIRTH_REQUIRED';

export interface AgePolicy {
  readonly version: number;
  readonly status: 'PLACEHOLDER_NOT_FOR_PRODUCTION' | 'APPROVED';
  readonly riderDeclarationMode: DeclarationMode;
  readonly riderMinimumAge: number | null;
  readonly driverMinimumAge: number | null;
  readonly effectiveAt: Date;
}

/** The current (non-retired, effective) version. None ⇒ fail closed with 503 — never "no age policy applies". */
export async function currentAgePolicy(q: Queryable): Promise<AgePolicy> {
  const r = await q.query<{
    version: number;
    status: AgePolicy['status'];
    rider_declaration_mode: DeclarationMode;
    rider_minimum_age: number | null;
    driver_minimum_age: number | null;
    effective_at: Date;
  }>(
    `select version, status, rider_declaration_mode, rider_minimum_age, driver_minimum_age, effective_at
       from legal.age_eligibility_policies
      where status <> 'RETIRED' and effective_at <= now()
      order by effective_at desc, version desc
      limit 1`,
  );
  const row = r.rows[0];
  if (!row) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { message: 'No age-eligibility policy is in effect.' });
  return {
    version: row.version,
    status: row.status,
    riderDeclarationMode: row.rider_declaration_mode,
    riderMinimumAge: row.rider_minimum_age,
    driverMinimumAge: row.driver_minimum_age,
    effectiveAt: row.effective_at,
  };
}
