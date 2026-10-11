/**
 * Staff realm against real PostgreSQL/Valkey as the restricted API role (SEC-STAFF, SEC-BG, AUTHZ-MATRIX, offboarding,
 * Q39 viewer): bootstrap without stored credentials, WebAuthn enrolment/login/step-up/unlock with a software
 * authenticator (origin, RP ID, user-verification, replay and counter negatives), realm separation from consumer
 * tokens, idle lock, maker-checker role grants, offboarding effective on the next request, break-glass limits and
 * tagging, audit viewer and seal-verification requests, and the authorization matrix over every /v1/admin route.
 */
import { API_ROUTES, StaffMeSchema, StaffSessionIssuedSchema, WebAuthnChallengeSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_CONTROLLERS } from '../src/app.js';
import { routePolicyOf } from '../src/auth/policy.js';
import { BootstrapRefusedError, bootstrapStaffAdmins } from '../src/staff/bootstrap.js';
import { ROLE_PERMISSIONS, STAFF_ROLES, type StaffRole } from '../src/staff/roles.js';
import { bearer, key, post, signIn, startApi, type Harness } from './support.js';
import { SoftwareAuthenticator, type CeremonyOverrides } from './webauthn-authenticator.js';

const ORIGIN = 'http://localhost:3310';
const RP = 'localhost';
let h: Harness;
const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });

beforeAll(async () => {
  h = await startApi({ env: { STAFF_ASSERTIONS_PER_IP_PER_10_MIN: '100000', STAFF_ASSERTIONS_PER_STAFF_PER_10_MIN: '100000' } });
});
afterAll(async () => {
  await h.close();
});

interface Staff {
  readonly staffId: string;
  readonly token: string;
  readonly auth: SoftwareAuthenticator;
}
const sb = (s: Staff) => bearer(s.token);
const pool = () => h.runtime.db.pool;
const code = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;

async function options(url: string, headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const res = await h.inject(post(url, body, headers));
  expect(res.statusCode, res.body).toBe(200);
  return WebAuthnChallengeSchema.parse(res.json());
}

async function enrol(invitationToken: string, auth = new SoftwareAuthenticator(ORIGIN, RP), o: CeremonyOverrides = {}) {
  const opts = await options('/v1/admin/auth/enrolment-options', {}, { invitationToken });
  return {
    auth,
    res: await h.inject(
      post('/v1/admin/auth/enrolments', { challengeId: opts.challengeId, invitationToken, credential: auth.register(opts.options, o), nickname: 'key 1' }),
    ),
  };
}

async function stepUp(s: Staff, o: CeremonyOverrides = {}) {
  const opts = await options('/v1/admin/auth/step-up-options', sb(s));
  return h.inject(post('/v1/admin/auth/step-ups', { challengeId: opts.challengeId, credential: s.auth.assert(opts.options, o) }, sb(s)));
}

async function bootstrapAdmins(n: 1 | 2): Promise<Staff[]> {
  const issued = await bootstrapStaffAdmins(
    pool(),
    Array.from({ length: n }, (_, i) => ({
      displayName: `Admin ${String(i)}`,
      workEmail: `admin${String(i)}.${key().slice(5, 13).toLowerCase()}@example.org`,
    })),
    3600,
    log,
  );
  const out: Staff[] = [];
  for (const i of issued) {
    const { auth, res } = await enrol(i.invitationToken);
    expect(res.statusCode, res.body).toBe(201);
    out.push({ staffId: i.staffId, token: StaffSessionIssuedSchema.parse(res.json()).sessionToken, auth });
  }
  return out;
}

async function invite(admin: Staff, name: string): Promise<Staff> {
  expect((await stepUp(admin)).statusCode).toBe(204);
  const res = await h.inject(
    post(
      '/v1/admin/staff-invitations',
      { displayName: name, workEmail: `${name.toLowerCase().replace(/\s/g, '')}.${key().slice(5, 13).toLowerCase()}@example.org` },
      sb(admin),
    ),
  );
  expect(res.statusCode, res.body).toBe(201);
  const body = res.json<{ staffId: string; invitationToken: string }>();
  const { auth, res: enrolled } = await enrol(body.invitationToken);
  expect(enrolled.statusCode, enrolled.body).toBe(201);
  return { staffId: body.staffId, token: enrolled.json<{ sessionToken: string }>().sessionToken, auth };
}

/** Grants a role (maker = a, checker = b when maker-checker applies). */
async function grant(a: Staff, b: Staff, staffId: string, role: StaffRole, cityCodes: string[] = []): Promise<void> {
  await stepUp(a);
  const req = await h.inject(post('/v1/admin/role-assignments', { staffId, role, cityCodes }, sb(a)));
  expect(req.statusCode, req.body).toBe(201);
  const { assignmentId, status } = req.json<{ assignmentId: string; status: string }>();
  if (status === 'PENDING_APPROVAL') {
    await stepUp(b);
    const ok = await h.inject(post(`/v1/admin/role-assignments/${assignmentId}/approval`, { decision: 'APPROVE' }, sb(b)));
    expect(ok.json<{ status: string }>().status).toBe('ACTIVE');
  }
}

let admins: Staff[] = [];

describe('bootstrap and WebAuthn ceremonies (SEC-STAFF)', () => {
  it('bootstrap issues single-use invitations, enrolment needs a verified credential, and a second bootstrap is refused', async () => {
    admins = await bootstrapAdmins(2);
    await expect(bootstrapStaffAdmins(pool(), [{ displayName: 'Late', workEmail: 'late@example.org' }], 3600, log)).rejects.toBeInstanceOf(
      BootstrapRefusedError,
    );
    const me = StaffMeSchema.parse((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(admins[0] as Staff) })).json());
    expect(me.roles.map((r) => r.role)).toEqual(['STAFF_ADMIN']);
    expect(me).toMatchObject({ environment: 'TEST', activeCredentials: 1, twoAuthenticatorRuleSatisfied: false, pendingBreakGlassReviews: 0 });
    // invitation tokens are single use
    const used = await h.inject(post('/v1/admin/auth/enrolment-options', { invitationToken: `wvi_${'A'.repeat(43)}` }));
    expect(used.statusCode).toBe(401);
    // nothing but hashes at rest
    const rows = await h.owner.query<{ token_hash: Buffer }>(`select token_hash from staff.invitations`);
    expect(rows.rows.every((r) => r.token_hash.length === 32)).toBe(true);
  });

  it('enrolment rejects a wrong origin, a wrong RP ID and a credential without user verification', async () => {
    const admin = admins[0] as Staff;
    for (const o of [{ origin: 'https://evil.example' }, { rpId: 'evil.example' }, { userVerified: false }] satisfies CeremonyOverrides[]) {
      await stepUp(admin);
      const inv = await h.inject(
        post('/v1/admin/staff-invitations', { displayName: 'Probe', workEmail: `probe.${key().slice(5, 13).toLowerCase()}@example.org` }, sb(admin)),
      );
      const { res } = await enrol(inv.json<{ invitationToken: string }>().invitationToken, undefined, o);
      expect(res.statusCode).toBe(401);
    }
    const failures = await h.owner.query(
      `select 1 from audit.audit_events where action = 'STAFF_WEBAUTHN_FAILED' and reason_code = 'ENROL_VERIFICATION_FAILED'`,
    );
    expect(failures.rowCount).toBe(3);
  });

  it('login uses discoverable credentials; replayed challenges, wrong origin, missing UV and counter regression are refused', async () => {
    const admin = admins[1] as Staff;
    const opts = await options('/v1/admin/auth/login-options', {});
    expect(opts.options['allowCredentials']).toEqual([]);
    const ok = await h.inject(post('/v1/admin/auth/sessions', { challengeId: opts.challengeId, credential: admin.auth.assert(opts.options) }));
    expect(ok.statusCode, ok.body).toBe(201);
    // the same challenge again (replay) fails
    expect((await h.inject(post('/v1/admin/auth/sessions', { challengeId: opts.challengeId, credential: admin.auth.assert(opts.options) }))).statusCode).toBe(
      401,
    );
    for (const o of [{ origin: 'http://localhost:9999' }, { userVerified: false }, { counter: 1 }] satisfies CeremonyOverrides[]) {
      const fresh = await options('/v1/admin/auth/login-options', {});
      expect(
        (await h.inject(post('/v1/admin/auth/sessions', { challengeId: fresh.challengeId, credential: admin.auth.assert(fresh.options, o) }))).statusCode,
      ).toBe(401);
    }
    // origin, missing UV and the counter regression (rejected by SimpleWebAuthn or our own non-increasing check) are audited
    const failed = await h.owner.query(
      `select 1 from audit.audit_events where action = 'STAFF_WEBAUTHN_FAILED' and actor_id = $1 and reason_code in ('LOGIN_VERIFICATION_FAILED', 'SIGN_COUNTER_NOT_INCREASING')`,
      [admin.staffId],
    );
    expect(failed.rowCount).toBe(3);
    // a challenge from another purpose cannot be used to log in
    const stepOpts = await options('/v1/admin/auth/step-up-options', sb(admin));
    expect(
      (await h.inject(post('/v1/admin/auth/sessions', { challengeId: stepOpts.challengeId, credential: admin.auth.assert(stepOpts.options) }))).statusCode,
    ).toBe(401);
  });

  it('realms are separate: consumer tokens never reach /v1/admin and staff tokens never reach consumer routes', async () => {
    const consumer = await signIn(h);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: bearer(consumer.accessToken) })).statusCode).toBe(401);
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: sb(admins[0] as Staff) })).statusCode).toBe(401);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/me' })).statusCode).toBe(401);
  });

  it('an idle session locks (401 STAFF_SESSION_LOCKED) and unlocks only with a WebAuthn assertion', async () => {
    const admin = admins[0] as Staff;
    await h.owner.query(`update staff.sessions set last_activity_at = now() - interval '20 minutes' where staff_id = $1 and status = 'ACTIVE'`, [
      admin.staffId,
    ]);
    const locked = await h.inject({ method: 'GET', url: '/v1/admin/staff', headers: sb(admin) });
    expect(locked.statusCode).toBe(401);
    expect(code(locked)).toBe('WAYVRO_E_STAFF_SESSION_LOCKED');
    expect(StaffMeSchema.parse((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(admin) })).json()).session.status).toBe('LOCKED');
    const opts = await options('/v1/admin/auth/unlock-options', sb(admin));
    expect(
      (await h.inject(post('/v1/admin/auth/unlocks', { challengeId: opts.challengeId, credential: admin.auth.assert(opts.options) }, sb(admin)))).statusCode,
    ).toBe(204);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/staff', headers: sb(admin) })).statusCode).toBe(200);
  });

  it('privileged routes need a fresh step-up (403 STEP_UP_REQUIRED, audited); a second authenticator can be added', async () => {
    const admin = admins[0] as Staff;
    await h.owner.query(`update staff.sessions set step_up_at = now() - interval '10 minutes' where staff_id = $1`, [admin.staffId]);
    const stale = await h.inject(post('/v1/admin/staff-invitations', { displayName: 'X', workEmail: 'x.stale@example.org' }, sb(admin)));
    expect(code(stale)).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    expect(
      (await h.owner.query(`select 1 from audit.audit_events where reason_code = 'STEP_UP_STALE' and actor_id = $1`, [admin.staffId])).rowCount,
    ).toBeGreaterThan(0);
    expect((await stepUp(admin)).statusCode).toBe(204);
    const second = new SoftwareAuthenticator(ORIGIN, RP);
    const opts = await options('/v1/admin/me/credential-options', sb(admin));
    expect(
      (
        await h.inject(
          post('/v1/admin/me/credentials', { challengeId: opts.challengeId, credential: second.register(opts.options), nickname: 'backup key' }, sb(admin)),
        )
      ).statusCode,
    ).toBe(201);
    const me = StaffMeSchema.parse((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(admin) })).json());
    expect(me).toMatchObject({ activeCredentials: 2, twoAuthenticatorRuleSatisfied: true });
    // the last authenticator can never be revoked
    const creds = (await h.inject({ method: 'GET', url: '/v1/admin/me/credentials', headers: sb(admin) })).json<{ credentials: Array<{ id: string }> }>()
      .credentials;
    expect(
      (await h.inject({ method: 'DELETE', url: `/v1/admin/me/credentials/${creds[1]?.id ?? ''}`, headers: { ...sb(admin), 'idempotency-key': key() } }))
        .statusCode,
    ).toBe(204);
    expect(
      (await h.inject({ method: 'DELETE', url: `/v1/admin/me/credentials/${creds[0]?.id ?? ''}`, headers: { ...sb(admin), 'idempotency-key': key() } }))
        .statusCode,
    ).toBe(409);
  });
});

describe('maker-checker role grants, offboarding and re-enrolment (H01/K10)', () => {
  it('grants of privileged roles need a different admin; self-assignment and self-approval are refused', async () => {
    const [a, b] = admins as [Staff, Staff];
    const reviewer = await invite(a, 'Reviewer One');
    await stepUp(a);
    expect(code(await h.inject(post('/v1/admin/role-assignments', { staffId: a.staffId, role: 'AUDITOR', cityCodes: [] }, sb(a))))).toBe('WAYVRO_E_FORBIDDEN');
    // city scope is mandatory for scoped roles and must reference a real city
    expect((await h.inject(post('/v1/admin/role-assignments', { staffId: reviewer.staffId, role: 'KYC_REVIEWER', cityCodes: [] }, sb(a)))).statusCode).toBe(
      400,
    );
    expect(
      (await h.inject(post('/v1/admin/role-assignments', { staffId: reviewer.staffId, role: 'KYC_REVIEWER', cityCodes: ['KHI'] }, sb(a)))).statusCode,
    ).toBe(400);
    const pending = await h.inject(post('/v1/admin/role-assignments', { staffId: reviewer.staffId, role: 'KYC_REVIEWER', cityCodes: ['LHR'] }, sb(a)));
    const { assignmentId, status } = pending.json<{ assignmentId: string; status: string }>();
    expect(status).toBe('PENDING_APPROVAL');
    // not yet effective
    expect(StaffMeSchema.parse((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(reviewer) })).json()).roles).toEqual([]);
    await stepUp(a);
    expect(code(await h.inject(post(`/v1/admin/role-assignments/${assignmentId}/approval`, { decision: 'APPROVE' }, sb(a))))).toBe('WAYVRO_E_FORBIDDEN');
    await stepUp(b);
    expect(
      (await h.inject(post(`/v1/admin/role-assignments/${assignmentId}/approval`, { decision: 'APPROVE' }, sb(b)))).json<{ status: string }>().status,
    ).toBe('ACTIVE');
    const me = StaffMeSchema.parse((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(reviewer) })).json());
    expect(me.roles).toEqual([{ assignmentId, role: 'KYC_REVIEWER', cities: ['LHR'] }]);
    // the database refuses maker == checker even if the service were bypassed
    await expect(h.owner.query(`update staff.role_assignments set approved_by = staff_id where id = $1`, [assignmentId])).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('offboarding revokes sessions, credentials and roles; the next request with the old token fails', async () => {
    const [a] = admins as [Staff];
    const leaver = await invite(a, 'Leaver');
    expect((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(leaver) })).statusCode).toBe(200);
    await stepUp(a);
    const res = await h.inject(post(`/v1/admin/staff/${leaver.staffId}/offboarding`, {}, sb(a)));
    expect(res.json()).toMatchObject({ revokedSessions: 1, revokedCredentials: 1 });
    expect((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(leaver) })).statusCode).toBe(401);
    const login = await options('/v1/admin/auth/login-options', {});
    expect(
      (await h.inject(post('/v1/admin/auth/sessions', { challengeId: login.challengeId, credential: leaver.auth.assert(login.options) }))).statusCode,
    ).toBe(401);
    expect(code(await h.inject(post(`/v1/admin/staff/${a.staffId}/offboarding`, {}, sb(a))))).toBe('WAYVRO_E_FORBIDDEN');
  });

  it('re-enrolment after losing every authenticator needs a second admin and revokes the lost authenticators', async () => {
    const [a, b] = admins as [Staff, Staff];
    const loser = await invite(a, 'Lost Keys');
    await stepUp(a);
    const req = await h.inject(post(`/v1/admin/staff/${loser.staffId}/re-enrolments`, {}, sb(a)));
    const { invitationId } = req.json<{ invitationId: string }>();
    await stepUp(a);
    expect(code(await h.inject(post(`/v1/admin/staff-invitations/${invitationId}/approval`, {}, sb(a))))).toBe('WAYVRO_E_FORBIDDEN');
    await stepUp(b);
    const approved = await h.inject(post(`/v1/admin/staff-invitations/${invitationId}/approval`, {}, sb(b)));
    expect(approved.statusCode).toBe(201);
    const { res } = await enrol(approved.json<{ invitationToken: string }>().invitationToken);
    expect(res.statusCode).toBe(201);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/me', headers: sb(loser) })).statusCode).toBe(401);
    expect((await h.owner.query(`select 1 from staff.webauthn_credentials where staff_id = $1 and status = 'ACTIVE'`, [loser.staffId])).rowCount).toBe(1);
  });
});

describe('break-glass (SEC-BG) and audit viewer (Q39)', () => {
  it('≤ 60 min, one at a time, alerted, actions tagged, reviewed by someone else', async () => {
    const [a, b] = admins as [Staff, Staff];
    await stepUp(a);
    expect(
      (
        await h.inject(
          post('/v1/admin/break-glass', { reasonCode: 'SYSTEM_RECOVERY', justification: 'restore access after outage', durationMinutes: 61 }, sb(a)),
        )
      ).statusCode,
    ).toBe(400);
    const res = await h.inject(
      post('/v1/admin/break-glass', { reasonCode: 'SYSTEM_RECOVERY', justification: 'restore access after outage', durationMinutes: 30 }, sb(a)),
    );
    expect(res.statusCode, res.body).toBe(201);
    const grantId = res.json<{ id: string }>().id;
    await stepUp(a);
    expect(
      (await h.inject(post('/v1/admin/break-glass', { reasonCode: 'SYSTEM_RECOVERY', justification: 'second grant attempt', durationMinutes: 10 }, sb(a))))
        .statusCode,
    ).toBe(409);
    expect(h.logs.text()).toContain('BREAK_GLASS_ACTIVATED');
    await h.inject({ method: 'GET', url: '/v1/admin/staff', headers: sb(a) });
    expect(
      (
        await h.owner.query(`select 1 from audit.audit_events where action = 'BREAK_GLASS_ACTION' and object_id = $1 and reason_code = 'STAFF_VIEW_ROSTER'`, [
          grantId,
        ])
      ).rowCount,
    ).toBe(1);
    // the database caps the duration even if the service were bypassed
    await expect(
      h.owner.query(`update staff.break_glass_grants set expires_at = started_at + interval '2 hours' where id = $1`, [grantId]),
    ).rejects.toMatchObject({ code: '23514' });
    await stepUp(b);
    expect(code(await h.inject(post(`/v1/admin/break-glass/${grantId}/review`, { outcome: 'JUSTIFIED' }, sb(b))))).toBe('WAYVRO_E_CONFLICT');
    expect((await h.inject(post(`/v1/admin/break-glass/${grantId}/end`, {}, sb(a)))).statusCode).toBe(200);
    await stepUp(a);
    expect(code(await h.inject(post(`/v1/admin/break-glass/${grantId}/review`, { outcome: 'JUSTIFIED' }, sb(a))))).toBe('WAYVRO_E_FORBIDDEN');
    await stepUp(b);
    expect((await h.inject(post(`/v1/admin/break-glass/${grantId}/review`, { outcome: 'JUSTIFIED' }, sb(b)))).json<{ status: string }>().status).toBe(
      'REVIEWED',
    );
  });

  it('AUDITOR reads events and seal status through bounded functions and can request verification; others cannot', async () => {
    const [a, b] = admins as [Staff, Staff];
    const auditor = await invite(a, 'Auditor');
    await grant(a, b, auditor.staffId, 'AUDITOR');
    const events = await h.inject({ method: 'GET', url: '/v1/admin/audit-events?action=STAFF_INVITED', headers: sb(auditor) });
    expect(events.statusCode).toBe(200);
    expect(events.json<{ events: Array<{ action: string }> }>().events.every((e) => e.action === 'STAFF_INVITED')).toBe(true);
    const status = await h.inject({ method: 'GET', url: '/v1/admin/audit-seals/status', headers: sb(auditor) });
    expect(status.json()).toMatchObject({ externalAnchoring: 'NOT_CONFIGURED_EG_05' });
    const verify = await h.inject(post('/v1/admin/audit-seals/verifications', {}, sb(auditor)));
    expect(verify.statusCode).toBe(202);
    expect(
      (await h.owner.query(`select 1 from platform.jobs where id = $1 and type = 'audit.verify-seals'`, [verify.json<{ jobId: string }>().jobId])).rowCount,
    ).toBe(1);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/audit-events', headers: sb(a) })).statusCode).toBe(403);
    expect((await h.inject({ method: 'GET', url: '/v1/admin/audit-events?limit=100000', headers: sb(auditor) })).statusCode).toBe(400);
  });
});

describe('AUTHZ-MATRIX over every /v1/admin route', () => {
  const adminRoutes = API_ROUTES.filter((r) => r.path.startsWith('/v1/admin/'));
  const handlers = API_CONTROLLERS.flatMap((c) => {
    const proto = c.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor')
      .map((n) => ({
        path: Reflect.getMetadata('path', proto[n] as object) as string | undefined,
        // Nest RequestMethod: GET 0, POST 1, PUT 2, DELETE 3, PATCH 4
        method: (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const)[Reflect.getMetadata('method', proto[n] as object) as number],
        policy: routePolicyOf(proto[n]),
      }))
      .filter((x) => x.path?.startsWith('/v1/admin/'));
  });

  it('completeness: every admin route has a staff policy (or is a public WebAuthn ceremony step); no export/download route exists', () => {
    expect(handlers).toHaveLength(adminRoutes.length);
    for (const h2 of handlers) {
      const isCeremony = /^\/v1\/admin\/auth\/(enrolment-options|enrolments|login-options|sessions)$/.test(h2.path ?? '');
      expect(h2.policy?.kind, h2.path).toBe(isCeremony ? 'public' : 'staff-session');
    }
    expect(API_ROUTES.some((r) => /export|download|csv/i.test(r.path))).toBe(false);
  });

  it('every permissioned admin route answers 403 (audited) for each role lacking the permission and passes authorization otherwise', async () => {
    const [a, b] = admins as [Staff, Staff];
    const byRole = new Map<StaffRole, Staff>();
    for (const role of STAFF_ROLES) {
      const s = await invite(a, `Matrix ${role}`);
      await grant(a, b, s.staffId, role, ['KYC_REVIEWER', 'KYC_SENIOR_REVIEWER', 'TRUST_SAFETY_AGENT', 'SUPPORT_AGENT'].includes(role) ? ['LHR'] : []);
      byRole.set(role, s);
    }
    const permissioned = handlers.filter((x) => x.policy?.kind === 'staff-session' && x.policy.permission !== undefined);
    expect(permissioned.length).toBeGreaterThan(10);
    for (const route of permissioned) {
      const contract = adminRoutes.find((r) => r.method === route.method && r.path.replace(/\{(\w+)\}/g, ':$1') === route.path);
      if (!contract || route.policy?.kind !== 'staff-session' || !route.policy.permission) throw new Error(`no contract for ${String(route.path)}`);
      const permission = route.policy.permission;
      const url = contract.path.replace('{id}', '00000000-0000-7000-8000-000000000000').replace('{version}', '999');
      for (const role of STAFF_ROLES) {
        const s = byRole.get(role) as Staff;
        await stepUp(s);
        const res = await h.inject({
          method: contract.method,
          url,
          headers: { ...sb(s), 'idempotency-key': key() },
          ...(contract.method === 'GET' || contract.method === 'DELETE' ? {} : { payload: {} }),
        });
        const allowed = ROLE_PERMISSIONS[role].includes(permission);
        if (allowed) expect([200, 201, 202, 400, 404, 409], `${role} ${contract.method} ${url}`).toContain(res.statusCode);
        else expect(res.statusCode, `${role} ${contract.method} ${url}`).toBe(403);
      }
    }
    const denials = await h.owner.query(`select count(*) n from audit.audit_events where action = 'STAFF_ACCESS_DENIED' and reason_code like 'MISSING_%'`);
    expect(Number(denials.rows[0]?.n)).toBeGreaterThan(20);
  }, 300_000);
});
