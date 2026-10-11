/**
 * Staff sessions (K10, Q42, H01; staff matrix §2). Separate realm: `wvs_` tokens, `staff.sessions`, `/v1/admin/*`.
 * The token lives only in the web-ops BFF's HttpOnly cookie and is forwarded as a bearer; the database stores SHA-256.
 *
 * Every request re-reads the session, the staff account and the ACTIVE role assignments (database time decides):
 * revocation, offboarding and role changes apply to the very next request. Idle > STAFF_SESSION_IDLE_SECONDS locks the
 * session (WebAuthn unlock required); absolute expiry ends it. Step-up freshness is checked per route.
 */
import { hashToken, newOpaqueToken, tokenKind } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import { CITY_SCOPED_ROLES, permissionsOf, type StaffPermission, type StaffRole } from './roles.js';

export interface StaffSessionPolicy {
  readonly STAFF_SESSION_IDLE_SECONDS: number;
  readonly STAFF_SESSION_ABSOLUTE_SECONDS: number;
  readonly STAFF_STEP_UP_SECONDS: number;
}

interface StaffAssignment {
  readonly id: string;
  readonly role: StaffRole;
  readonly cities: readonly string[];
}

export interface StaffPrincipal {
  readonly staffId: string;
  readonly sessionId: string;
  readonly sessionStatus: 'ACTIVE' | 'LOCKED';
  readonly displayName: string;
  readonly consumerAccountId: string | null;
  readonly assignments: readonly StaffAssignment[];
  readonly permissions: ReadonlySet<StaffPermission>;
  readonly stepUpAt: Date | null;
  readonly activeCredentials: number;
  readonly breakGlassId: string | null;
  readonly absoluteExpiresAt: Date;
}

/** Creates a session for a staff member who just completed a WebAuthn ceremony; returns the raw token (once). */
export async function openStaffSession(
  tx: Queryable,
  staffId: string,
  credentialRowId: string,
  policy: StaffSessionPolicy,
): Promise<{ sessionId: string; token: string; absoluteExpiresAt: Date }> {
  const sessionId = uuidv7();
  const token = newOpaqueToken('staff');
  // A fresh WebAuthn assertion counts as a step-up for the next STAFF_STEP_UP_SECONDS.
  const r = await tx.query<{ absolute_expires_at: Date }>(
    `insert into staff.sessions (id, staff_id, credential_id, status, token_hash, absolute_expires_at, step_up_at)
     values ($1, $2, $3, 'ACTIVE', $4, now() + ($5::int * interval '1 second'), now()) returning absolute_expires_at`,
    [sessionId, staffId, credentialRowId, hashToken(token), policy.STAFF_SESSION_ABSOLUTE_SECONDS],
  );
  const absoluteExpiresAt = r.rows[0]?.absolute_expires_at;
  if (!absoluteExpiresAt) throw new Error('staff session insert returned no row');
  return { sessionId, token, absoluteExpiresAt };
}

interface SessionRow {
  session_id: string;
  staff_id: string;
  status: 'ACTIVE' | 'LOCKED';
  idle: boolean;
  absolute_expires_at: Date;
  step_up_at: Date | null;
  staff_status: string;
  display_name: string;
  consumer_account_id: string | null;
}

/**
 * Resolves the staff principal of a bearer token, or throws:
 * 401 UNAUTHENTICATED (no/unknown/revoked/expired token, staff not ACTIVE) or 401 STAFF_SESSION_LOCKED (idle lock).
 * Locks an idle session as a side effect. `allowLocked` serves the unlock/logout/me routes.
 */
export async function resolveStaffPrincipal(q: Queryable, token: string | null, policy: StaffSessionPolicy, allowLocked: boolean): Promise<StaffPrincipal> {
  if (token === null || tokenKind(token) !== 'staff') throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  const r = await q.query<SessionRow>(
    `select s.id session_id, s.staff_id, s.status, s.last_activity_at < now() - ($2::int * interval '1 second') idle, s.absolute_expires_at, s.step_up_at,
            a.status staff_status, a.display_name, a.consumer_account_id
       from staff.sessions s join staff.staff_accounts a on a.id = s.staff_id
      where s.token_hash = $1 and s.status <> 'REVOKED' and s.absolute_expires_at > now()`,
    [hashToken(token), policy.STAFF_SESSION_IDLE_SECONDS],
  );
  const row = r.rows[0];
  if (!row) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  if (row.staff_status !== 'ACTIVE') {
    await appendAudit(q, {
      actor: { type: 'STAFF', id: row.staff_id },
      action: 'STAFF_ACCESS_DENIED',
      objectType: 'staff.session',
      objectId: row.session_id,
      outcome: 'DENIED',
      reasonCode: 'STAFF_NOT_ACTIVE',
    });
    throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  }
  let status = row.status;
  if (status === 'ACTIVE' && row.idle) {
    await q.query(`update staff.sessions set status = 'LOCKED' where id = $1 and status = 'ACTIVE'`, [row.session_id]);
    await appendAudit(q, {
      actor: { type: 'STAFF', id: row.staff_id },
      action: 'STAFF_SESSION_LOCKED',
      objectType: 'staff.session',
      objectId: row.session_id,
      outcome: 'SUCCESS',
      reasonCode: 'IDLE_TIMEOUT',
    });
    status = 'LOCKED';
  }
  if (status === 'LOCKED' && !allowLocked) throw new WayvroError('WAYVRO_E_STAFF_SESSION_LOCKED');
  if (status === 'ACTIVE') await q.query(`update staff.sessions set last_activity_at = now() where id = $1`, [row.session_id]);
  const assignments = await q.query<{ id: string; role: StaffRole; cities: string[] | null }>(
    `select ra.id, ra.role, array_remove(array_agg(c.city_code order by c.city_code), null) cities
       from staff.role_assignments ra left join staff.role_assignment_cities c on c.assignment_id = ra.id
      where ra.staff_id = $1 and ra.status = 'ACTIVE' and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
      group by ra.id, ra.role order by ra.role`,
    [row.staff_id],
  );
  const extras = await q.query<{ credentials: string; break_glass_id: string | null }>(
    `select (select count(*) from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE') credentials,
            (select id from staff.break_glass_grants where staff_id = $1 and status = 'ACTIVE' and expires_at > now()) break_glass_id`,
    [row.staff_id],
  );
  const list = assignments.rows.map((a) => ({ id: a.id, role: a.role, cities: a.cities ?? [] }));
  return {
    staffId: row.staff_id,
    sessionId: row.session_id,
    sessionStatus: status,
    displayName: row.display_name,
    consumerAccountId: row.consumer_account_id,
    assignments: list,
    permissions: permissionsOf(list.map((a) => a.role)),
    stepUpAt: row.step_up_at,
    activeCredentials: Number(extras.rows[0]?.credentials ?? 0),
    breakGlassId: extras.rows[0]?.break_glass_id ?? null,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

/** Database-time step-up freshness (≤ STAFF_STEP_UP_SECONDS since the last WebAuthn assertion). */
export async function stepUpFresh(q: Queryable, principal: StaffPrincipal, policy: StaffSessionPolicy): Promise<boolean> {
  const r = await q.query<{ fresh: boolean }>(
    `select step_up_at is not null and step_up_at > now() - ($2::int * interval '1 second') fresh from staff.sessions where id = $1`,
    [principal.sessionId, policy.STAFF_STEP_UP_SECONDS],
  );
  return r.rows[0]?.fresh === true;
}

/** Cities in which a permission applies (ABAC cityScope). `null` = not city-scoped (any city); empty = none. */
export function citiesFor(principal: StaffPrincipal, permission: StaffPermission): ReadonlySet<string> | null {
  const cities = new Set<string>();
  for (const a of principal.assignments) {
    if (!permissionsOf([a.role]).has(permission)) continue;
    if (!CITY_SCOPED_ROLES.has(a.role)) return null;
    for (const c of a.cities) cities.add(c);
  }
  return cities;
}

/** True when the staff member holds `role` in an ACTIVE assignment. */
export function hasRole(principal: StaffPrincipal, role: StaffRole): boolean {
  return principal.assignments.some((a) => a.role === role);
}
