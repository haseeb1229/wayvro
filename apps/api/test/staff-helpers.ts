/** Shared staff-realm helpers for API integration tests (bootstrap, enrol, invite, maker-checker grants, step-up). */
import { StaffSessionIssuedSchema, WebAuthnChallengeSchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { expect } from 'vitest';
import { bootstrapStaffAdmins } from '../src/staff/bootstrap.js';
import type { StaffRole } from '../src/staff/roles.js';
import { bearer, key, post, type Harness } from './support.js';
import { SoftwareAuthenticator, type CeremonyOverrides } from './webauthn-authenticator.js';

const ORIGIN = 'http://localhost:3310';
const RP = 'localhost';
const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });

export interface Staff {
  readonly staffId: string;
  readonly token: string;
  readonly auth: SoftwareAuthenticator;
}

export const STAFF_ENV = { STAFF_ASSERTIONS_PER_IP_PER_10_MIN: '100000', STAFF_ASSERTIONS_PER_STAFF_PER_10_MIN: '100000' } as const;

export function staffKit(h: Harness) {
  const sb = (s: Staff) => bearer(s.token);
  const options = async (url: string, headers: Record<string, string>, body: Record<string, unknown> = {}) => {
    const res = await h.inject(post(url, body, headers));
    expect(res.statusCode, res.body).toBe(200);
    return WebAuthnChallengeSchema.parse(res.json());
  };
  const enrol = async (invitationToken: string, auth = new SoftwareAuthenticator(ORIGIN, RP), o: CeremonyOverrides = {}) => {
    const opts = await options('/v1/admin/auth/enrolment-options', {}, { invitationToken });
    return {
      auth,
      res: await h.inject(
        post('/v1/admin/auth/enrolments', { challengeId: opts.challengeId, invitationToken, credential: auth.register(opts.options, o), nickname: 'key 1' }),
      ),
    };
  };
  const stepUp = async (s: Staff, o: CeremonyOverrides = {}) => {
    const opts = await options('/v1/admin/auth/step-up-options', sb(s));
    return h.inject(post('/v1/admin/auth/step-ups', { challengeId: opts.challengeId, credential: s.auth.assert(opts.options, o) }, sb(s)));
  };
  const bootstrapAdmins = async (n: 1 | 2): Promise<Staff[]> => {
    const issued = await bootstrapStaffAdmins(
      h.runtime.db.pool,
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
  };
  const invite = async (admin: Staff, name: string): Promise<Staff> => {
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
  };
  /** Grants a role (maker = a, checker = b when maker-checker applies). */
  const grant = async (a: Staff, b: Staff, staffId: string, role: StaffRole, cityCodes: string[] = []): Promise<void> => {
    await stepUp(a);
    const req = await h.inject(post('/v1/admin/role-assignments', { staffId, role, cityCodes }, sb(a)));
    expect(req.statusCode, req.body).toBe(201);
    const { assignmentId, status } = req.json<{ assignmentId: string; status: string }>();
    if (status === 'PENDING_APPROVAL') {
      await stepUp(b);
      const ok = await h.inject(post(`/v1/admin/role-assignments/${assignmentId}/approval`, { decision: 'APPROVE' }, sb(b)));
      expect(ok.json<{ status: string }>().status).toBe('ACTIVE');
    }
  };
  /** A staff member holding `role` (city-scoped roles get LHR). */
  const staffWithRole = async (admins: readonly Staff[], role: StaffRole, name: string): Promise<Staff> => {
    const [a, b] = admins as [Staff, Staff];
    const s = await invite(a, name);
    await grant(a, b, s.staffId, role, ['KYC_REVIEWER', 'KYC_SENIOR_REVIEWER', 'TRUST_SAFETY_AGENT', 'SUPPORT_AGENT'].includes(role) ? ['LHR'] : []);
    return s;
  };
  /** Steps up then calls a privileged route as `s`. */
  const privileged = async (s: Staff, url: string, body: unknown) => {
    await stepUp(s);
    return h.inject(post(url, body, sb(s)));
  };
  return { sb, options, enrol, stepUp, bootstrapAdmins, invite, grant, staffWithRole, privileged };
}
