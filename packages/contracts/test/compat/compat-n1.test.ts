/**
 * COMPAT-N1 (docs/phase3/PHASE3_TEST_STRATEGY.md §4.10; PR Quality tier): a Phase-2 client keeps working against the
 * Phase-3 API on every route both phases share.
 *
 *  - Responses: the FROZEN Phase-2 response schemas (./phase2, main @ b1a1986) parse Phase-3 responses — proven per
 *    shared route and success status both structurally (every Phase-3 value is accepted by the Phase-2 parser) and by
 *    parsing representative Phase-3 bodies (hand-written for every changed response, plus deterministic synthetic
 *    samples that visit every enum value, nullable branch and optional field).
 *  - Closed enums: no value appears in a Phase-3 response enum that the Phase-2 parser does not know, unless the field
 *    is an allow-listed extensible vocabulary with a written justification (EXTENSIBLE_RESPONSE_ENUMS).
 *  - Requests: every Phase-2 request (body, query, path parameters) still validates, and strict Phase-2 request
 *    objects stay strict in Phase 3 (unknown keys are still refused — no mass assignment).
 *  - Errors: ERROR_CODES is append-only and the Phase-2 error envelope parses Phase-3 envelopes of every Phase-2 code.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  API_ROUTES,
  AccountStateSchema,
  DriverApplicationSchema,
  DriverComplianceSchema,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  StaffMeSchema,
  StaffRosterSchema,
  type RouteContract,
} from '../../src/index.js';
import { ERROR_CODES as P2_ERROR_CODES, ErrorEnvelopeSchema as P2ErrorEnvelopeSchema } from './phase2/errors.js';
import { AccountStateSchema as P2AccountStateSchema } from './phase2/identity.js';
import { API_ROUTES as P2_API_ROUTES } from './phase2/openapi.js';
import { checkAccepts, generateSamples, strictObjectPaths, toJsonSchema, type CompatReport, type JsonSchema } from './json-schema-compat.js';

// ── allow-list: closed Phase-2 response enums that may grow (each entry is a reviewed, justified exception) ─────────
interface ExtensibleEnum {
  /** `<operationId> <status> <data path>` */
  readonly key: string;
  readonly justification: string;
}
const STAFF_ROLE_JUSTIFICATION =
  'Staff roles are a code-defined vocabulary that grows additively (H01; Phase 3 adds PRICING_MANAGER, CATALOG_MANAGER, ' +
  'RELEASE_MANAGER, FA-10) and is documented as x-extensible-enum (openapi.ts EXTENSIBLE_ENUMS). The Phase-2 parser of ' +
  'this response DOES reject an unknown role (asserted below): its only consumer is the private web-ops BFF, which is ' +
  'deployed from the same commit as the API, so no Phase-2 web-ops build parses a Phase-3 API response.';
const EXTENSIBLE_RESPONSE_ENUMS: readonly ExtensibleEnum[] = [
  { key: 'staffMe 200 $.roles[].role', justification: STAFF_ROLE_JUSTIFICATION },
  { key: 'staffRoster 200 $.staff[].roles[].role', justification: STAFF_ROLE_JUSTIFICATION },
];
/**
 * The error envelope's `code` is a closed z.enum in the Phase-2 contract, and the Phase-2 mobile app
 * (apps/wayvro-mobile/src/core/api/errors.ts @ b1a1986) and web-public deletion form parse envelopes with it. A Phase-3
 * code therefore makes the WHOLE Phase-2 envelope parse fail (asserted below); both Phase-2 clients then fall back to
 * the HTTP status (`kindForStatus`) by design, losing only code-specific handling, `requestId` and retry hints for that
 * response. Error codes are an append-only registry by contract (errors.ts; documented as x-extensible-enum).
 */
const ERROR_CODE_PATH = '$.error.code';

// ── synthetic fixtures (no real people, numbers, tokens or documents) ───────────────────────────────────────────────
const id = (n: number): string => `0190f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-14T09:30:00.000Z';

type Row = Record<string, unknown>;
const restriction = (scope: string, affectsRiderUse: boolean): Row => ({
  id: id(90),
  scope,
  reasonCode: 'SYNTHETIC_REASON',
  reasonClass: 'COMPLIANCE',
  appealable: true,
  effectiveUntil: null,
  affectsRiderUse,
});
const accountState = (overrides: Row): Row => ({
  account: { id: id(1), status: 'ACTIVE', displayName: 'Synthetic Rider', preferredLocale: 'ur', createdAt: '2026-09-01T08:00:00.000Z' },
  session: { id: id(2), assurance: 'OTP', accessTokenExpiresAt: AT, stepUpExpiresAt: null },
  riderProfile: { id: id(3), status: 'ACTIVE' },
  requiredActions: [],
  driver: { application: null, profile: null, onboardingAvailable: true },
  restrictions: [],
  ...overrides,
});
const modes = (rider: readonly string[], entry: 'NONE' | 'ONBOARDING' | 'HUB', driver: readonly string[]): Row => ({
  rider: { available: rider.length === 0, blockers: rider },
  driver: { entry, available: entry !== 'NONE', blockers: driver },
});
/** Phase-3 AccountState bodies, one per mode situation (modes as the server derives them, ADR-048). */
const ACCOUNT_STATES: ReadonlyArray<readonly [string, Row]> = [
  ['rider only, onboarding offered', accountState({ modes: modes([], 'ONBOARDING', []) })],
  [
    'rider only, onboarding unavailable',
    accountState({ driver: { application: null, profile: null, onboardingAvailable: false }, modes: modes([], 'NONE', ['ONBOARDING_UNAVAILABLE']) }),
  ],
  [
    'application pending',
    accountState({
      driver: { application: { id: id(4), state: 'MANUAL_REVIEW' }, profile: null, onboardingAvailable: true },
      modes: modes([], 'ONBOARDING', ['APPLICATION_PENDING']),
    }),
  ],
  [
    'application rejected',
    accountState({
      driver: { application: { id: id(4), state: 'REJECTED' }, profile: null, onboardingAvailable: true },
      modes: modes([], 'ONBOARDING', ['APPLICATION_REJECTED']),
    }),
  ],
  [
    'driver profile present (hub)',
    accountState({
      session: { id: id(2), assurance: 'OTP', accessTokenExpiresAt: AT, stepUpExpiresAt: AT },
      driver: { application: { id: id(4), state: 'VERIFIED' }, profile: { id: id(5), state: 'ACTIVE_ELIGIBLE' }, onboardingAvailable: true },
      modes: modes([], 'HUB', []),
    }),
  ],
  [
    'driver documents expired',
    accountState({
      driver: { application: { id: id(4), state: 'VERIFIED' }, profile: { id: id(5), state: 'EXPIRED' }, onboardingAvailable: true },
      modes: modes([], 'HUB', ['DOCUMENTS_EXPIRED']),
    }),
  ],
  [
    'driver re-verification due',
    accountState({
      driver: { application: { id: id(4), state: 'VERIFIED' }, profile: { id: id(5), state: 'REVERIFY_DUE' }, onboardingAvailable: false },
      modes: modes([], 'HUB', ['PROFILE_REVERIFICATION_DUE']),
    }),
  ],
  [
    'driver role restricted (rider use unaffected)',
    accountState({
      driver: { application: { id: id(4), state: 'VERIFIED' }, profile: { id: id(5), state: 'VERIFIED' }, onboardingAvailable: true },
      restrictions: [restriction('DRIVER_ROLE', false)],
      modes: modes([], 'HUB', ['ROLE_RESTRICTED']),
    }),
  ],
  [
    'account restricted',
    accountState({
      requiredActions: ['ACCEPT_POLICIES'],
      driver: { application: { id: id(4), state: 'VERIFIED' }, profile: { id: id(5), state: 'VERIFIED' }, onboardingAvailable: true },
      restrictions: [restriction('ACCOUNT', true), restriction('VEHICLE', false)],
      modes: modes(['ACCOUNT_RESTRICTED'], 'HUB', ['ACCOUNT_RESTRICTED']),
    }),
  ],
  [
    'deletion pending',
    accountState({
      account: { id: id(1), status: 'DELETION_PENDING', displayName: null, preferredLocale: 'ur-Latn', createdAt: '2026-09-01T08:00:00.000Z' },
      modes: modes(['DELETION_PENDING'], 'ONBOARDING', ['DELETION_PENDING']),
    }),
  ],
  ['modes omitted (optional during the release window)', accountState({})],
];

const vehicle = (claims: Row): Row => ({
  id: id(20),
  plateDisplay: 'LEA-1234',
  make: 'Synthetic',
  model: 'Hatch',
  modelYear: 2019,
  colour: 'White',
  serviceCategory: 'CAR',
  ownershipType: 'REGISTERED_OWNER',
  relation: 'OWNER',
  version: 2,
  ...claims,
});
const DRIVER_APPLICATIONS: readonly Row[] = [
  {
    id: id(4),
    state: 'NEEDS_INFO',
    version: 7,
    cityCode: 'LHE',
    serviceCategories: ['CAR', 'BIKE'],
    claims: { legalNameProvided: true, cnicLast4: '0000', dateOfBirthProvided: true },
    vehicles: [vehicle({ seats: 4, bodyType: 'HATCHBACK', airConditioned: true }), vehicle({ id: id(21), seats: null, bodyType: null, airConditioned: null })],
    documents: [
      {
        id: id(30),
        documentType: 'DRIVING_LICENCE',
        vehicleId: null,
        districtCode: 'LHE-01',
        numberLast4: '0000',
        licenceClass: 'LTV',
        claimedExpiresOn: '2028-01-31',
        status: 'UNDER_REVIEW',
      },
    ],
    pendingPolicies: [],
    createdAt: '2026-09-02T08:00:00.000Z',
    submittedAt: '2026-09-03T08:00:00.000Z',
    review: {
      latestDecision: { decisionId: id(40), decision: 'NEEDS_INFO', reasonCodes: ['DOCUMENT_UNREADABLE'], decidedAt: AT, appealable: false },
      inPersonRequired: false,
      openAppealId: null,
    },
  },
  {
    id: id(4),
    state: 'DRAFT',
    version: 1,
    cityCode: 'LHE',
    serviceCategories: ['RICKSHAW'],
    claims: { legalNameProvided: false, cnicLast4: null, dateOfBirthProvided: false },
    vehicles: [vehicle({ serviceCategory: 'RICKSHAW', bodyType: 'AUTO_RICKSHAW' })],
    documents: [],
    pendingPolicies: ['DRIVER_PARTNER_AGREEMENT'],
    createdAt: '2026-09-02T08:00:00.000Z',
    submittedAt: null,
  },
];
const DRIVER_COMPLIANCE: readonly Row[] = [
  {
    profile: { id: id(5), state: 'VERIFIED' },
    eligibility: [
      {
        vehicleId: id(20),
        cityCode: 'LHE',
        serviceCategory: 'CAR',
        eligible: false,
        blockers: [{ code: 'DOCUMENT_EXPIRED', documentType: 'VEHICLE_FITNESS' }],
      },
    ],
    documents: [
      {
        id: id(30),
        documentType: 'VEHICLE_FITNESS',
        vehicleId: id(20),
        districtCode: null,
        numberLast4: null,
        licenceClass: null,
        claimedExpiresOn: '2026-10-01',
        status: 'EXPIRED',
        expiresOn: '2026-10-01',
        renewalDue: true,
        hasNumber: false,
        hasExpiry: true,
        renewal: { renewalDocumentId: id(31), status: 'REJECTED', evidenceKinds: ['DOCUMENT_FRONT'], appealableDecisionId: id(41), appealStatus: 'SUBMITTED' },
      },
    ],
    applicationId: id(4),
    restrictions: [restriction('VEHICLE', false)],
    productEligibility: [
      { vehicleId: id(20), productCode: 'ECONOMY', result: 'ELIGIBLE', reasons: [], missingAttributes: [], ruleVersion: 1 },
      { vehicleId: id(20), productCode: 'COMFORT', result: 'UNKNOWN', reasons: [], missingAttributes: ['seats', 'airConditioned'], ruleVersion: 2 },
      {
        vehicleId: id(20),
        productCode: 'COMFORT_PLUS',
        result: 'NOT_ELIGIBLE',
        reasons: ['VEHICLE_TOO_OLD', 'AC_REQUIRED'],
        missingAttributes: [],
        ruleVersion: 3,
      },
      { vehicleId: id(20), productCode: 'BIKE', result: 'NOT_OFFERED', reasons: ['DISABLED_LEGAL_GATE'], missingAttributes: [], ruleVersion: null },
    ],
  },
  { profile: { id: id(5), state: 'ACTIVE_ELIGIBLE' }, eligibility: [], documents: [], restrictions: [] },
];
const staffMe = (role: string): Row => ({
  staff: { id: id(60), displayName: 'Synthetic Reviewer' },
  session: { id: id(61), status: 'ACTIVE', absoluteExpiresAt: AT, stepUpFresh: true },
  roles: [{ assignmentId: id(62), role, cities: ['LHE'] }],
  permissions: ['review.case.read'],
  activeCredentials: 2,
  twoAuthenticatorRuleSatisfied: true,
  breakGlass: null,
  environment: 'TEST',
  pendingBreakGlassReviews: null,
});
const staffRoster = (role: string): Row => ({
  staff: [
    {
      id: id(60),
      displayName: 'Synthetic Reviewer',
      status: 'ACTIVE',
      roles: [{ assignmentId: id(62), role, status: 'ACTIVE', cities: ['LHE'] }],
      activeCredentials: 2,
    },
  ],
  nextCursor: null,
});

/**
 * Hand-written representative Phase-3 bodies per response schema. Every shared response whose Phase-3 schema differs
 * from Phase 2 MUST have an entry (asserted), so a changed response can never be proven by synthetic samples alone.
 */
const RESPONSE_FIXTURES = new Map<z.ZodType, readonly unknown[]>([
  [AccountStateSchema, ACCOUNT_STATES.map(([, body]) => body)],
  [DriverApplicationSchema, DRIVER_APPLICATIONS],
  [DriverComplianceSchema, DRIVER_COMPLIANCE],
  // Phase-2 roles only: a Phase-3 role is the allow-listed staff-role finding, asserted separately below
  [StaffMeSchema, [staffMe('KYC_REVIEWER'), staffMe('AUDITOR')]],
  [StaffRosterSchema, [staffRoster('SUPPORT_AGENT')]],
]);

/** Representative Phase-2 client requests for schemas whose cross-field rules synthetic samples cannot satisfy. */
const oidc = { provider: 'GOOGLE', idToken: 'aaa.bbb.ccc', nonceId: id(70) };
const REQUEST_FIXTURES: Readonly<Record<string, readonly unknown[]>> = {
  'createAccountRecovery body': [
    { proof: 'LINKED_OIDC', previousPhone: '03001234567', oidc },
    { proof: 'DRIVER_KYC', previousPhone: '03001234567' },
  ],
  'updateProfile body': [{ displayName: 'Synthetic Rider' }, { preferredLocale: 'ur-Latn' }, { displayName: null }],
  'recordAgeDeclaration body': [
    { policyVersion: 1, affirmed: true },
    { policyVersion: 1, dateOfBirth: '1990-01-31' },
  ],
  'createAppeal body': [
    { reviewDecisionId: id(40), statement: 'A synthetic appeal statement.' },
    { restrictionId: id(90), statement: 'A synthetic appeal statement.' },
  ],
  'viewAccountSummary body': [
    { phone: '+923001234567', reasonCode: 'SAFETY_REPORT' },
    { accountId: id(1), reasonCode: 'RECOVERY_ASSISTANCE' },
  ],
  'revokeSessionsOnBehalf body': [
    { scope: 'ONE', sessionId: id(2), reasonCode: 'FRAUD_INVESTIGATION' },
    { scope: 'ALL', reasonCode: 'FRAUD_INVESTIGATION' },
  ],
  'draftAgePolicy body': [
    {
      driverMinimumAge: 77,
      guardianRulesRef: null,
      approvalRef: 'COUNSEL-MEMO-SYNTHETIC',
      effectiveAt: '2026-11-01T00:00:00Z',
      riderDeclarationMode: 'NONE',
      riderMinimumAge: null,
    },
  ],
};

// ── shared-route inventory ──────────────────────────────────────────────────────────────────────────────────────────
type Route = Pick<RouteContract, 'operationId' | 'method' | 'path' | 'auth' | 'request' | 'params' | 'query' | 'responses' | 'binaryResponses'>;
const routeKey = (r: Route): string => `${r.method} ${r.path}`;
const P3_BY_KEY = new Map<string, Route>(API_ROUTES.map((r) => [routeKey(r), r]));
const SHARED: ReadonlyArray<{ readonly p2: Route; readonly p3: Route }> = (P2_API_ROUTES as readonly Route[]).flatMap((p2) => {
  const p3 = P3_BY_KEY.get(routeKey(p2));
  return p3 ? [{ p2, p3 }] : [];
});
const successStatuses = (r: Route): readonly number[] =>
  Object.keys(r.responses)
    .map(Number)
    .filter((s) => s >= 200 && s < 300)
    .sort((a, b) => a - b);

interface ResponseCase {
  readonly name: string;
  readonly operationId: string;
  readonly status: number;
  readonly p2: z.ZodType;
  readonly p3: z.ZodType;
}
/** Statuses with a JSON body that is not the error envelope (2xx bodies, plus e.g. the 503 readiness body). */
const bodyStatuses = (r: Route): readonly number[] =>
  Object.keys(r.responses)
    .map(Number)
    .filter((s) => {
      const schema = r.responses[s];
      return schema !== null && schema !== undefined && schema !== P2ErrorEnvelopeSchema && schema !== ErrorEnvelopeSchema;
    });
const RESPONSE_CASES: readonly ResponseCase[] = SHARED.flatMap(({ p2, p3 }) =>
  bodyStatuses(p2).flatMap((status) => {
    const s2 = p2.responses[status];
    const s3 = p3.responses[status];
    return s2 && s3 ? [{ name: `${p2.operationId} ${String(status)}`, operationId: p2.operationId, status, p2: s2, p3: s3 }] : [];
  }),
);

const extensiblePaths = (c: ResponseCase): ReadonlySet<string> =>
  new Set(EXTENSIBLE_RESPONSE_ENUMS.filter((e) => e.key.startsWith(`${c.name} `)).map((e) => e.key.slice(c.name.length + 1)));
const reports = new Map<string, CompatReport>();
/** Phase-3 (io output: what the server sends) ⊆ Phase-2 (io input: what the old client's parser accepts). */
const responseReport = (c: ResponseCase): CompatReport => {
  const cached = reports.get(c.name);
  if (cached) return cached;
  const report = checkAccepts(toJsonSchema(c.p3, 'output'), toJsonSchema(c.p2, 'input'), { extensibleEnumPaths: extensiblePaths(c) });
  reports.set(c.name, report);
  return report;
};

const parseFailure = (schema: z.ZodType, body: unknown): string | null => {
  const result = schema.safeParse(body);
  return result.success ? null : `${JSON.stringify(result.error.issues)} for ${JSON.stringify(body)}`;
};

describe('COMPAT-N1 shared-route inventory', () => {
  it('finds the shared routes; none was removed, renamed or re-authed, and success statuses are unchanged', () => {
    expect(SHARED.length).toBeGreaterThan(0);
    const removed = (P2_API_ROUTES as readonly Route[]).filter((r) => !P3_BY_KEY.has(routeKey(r))).map(routeKey);
    expect(removed, 'a Phase-2 route disappeared from API_ROUTES (breaking for Phase-2 clients)').toEqual([]);
    for (const { p2, p3 } of SHARED) {
      const name = routeKey(p2);
      expect(p3.operationId, name).toBe(p2.operationId);
      expect(p3.auth, name).toBe(p2.auth);
      expect(successStatuses(p3), name).toEqual(successStatuses(p2));
      for (const status of successStatuses(p2))
        expect(p3.responses[status] === null, `${name} ${String(status)} body presence`).toBe(p2.responses[status] === null);
      expect(p3.binaryResponses, name).toEqual(p2.binaryResponses);
      expect(bodyStatuses(p3), `${name}: a Phase-2 response body status lost its body`).toEqual(expect.arrayContaining([...bodyStatuses(p2)]));
    }
    expect(RESPONSE_CASES.length).toBeGreaterThan(0);
  });
});

describe('COMPAT-N1 AccountState: the Phase-2 parser accepts Phase-3 bodies with the additive modes', () => {
  it.each(ACCOUNT_STATES)('%s', (_name, body) => {
    expect(parseFailure(AccountStateSchema, body), 'fixture must be a valid Phase-3 AccountState').toBeNull();
    expect(parseFailure(P2AccountStateSchema, body)).toBeNull();
    // the Phase-2 client sees exactly the Phase-2 fields: the additive `modes` is stripped, nothing else changes
    const phase2Fields = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'modes'));
    expect(P2AccountStateSchema.parse(body)).toEqual(phase2Fields);
  });

  it('the Phase-2 AccountState parser strips (never rejects) additive fields, at every level', () => {
    const report = responseReport(RESPONSE_CASES.find((c) => c.operationId === 'getAccountState')!);
    expect(report.violations).toEqual([]);
    expect(report.additiveFields).toContain('$.modes');
    expect(P2AccountStateSchema.safeParse({ ...ACCOUNT_STATES[0]![1], aLaterField: { nested: true } }).success).toBe(true);
  });
});

describe('COMPAT-N1 shared-route responses: Phase-2 schemas parse Phase-3 responses', () => {
  it.each(RESPONSE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const report = responseReport(c);
    expect(report.violations, `${c.name}: a Phase-3 response the Phase-2 parser may reject`).toEqual([]);

    const changed = JSON.stringify(toJsonSchema(c.p3, 'output')) !== JSON.stringify(toJsonSchema(c.p2, 'output'));
    const fixtures = RESPONSE_FIXTURES.get(c.p3);
    if (changed) expect(fixtures, `${c.name}: its response changed since Phase 2 — add a representative fixture to RESPONSE_FIXTURES`).toBeDefined();

    // synthetic samples visit every enum value / nullable branch / optional field; allow-listed extensible enums are
    // restricted to the Phase-2 vocabulary here (their widening is asserted separately)
    const phase2Vocabulary = new Map(report.enums.filter((e) => e.added.length > 0).map((e) => [e.path, e.consumer]));
    const synthetic = generateSamples(toJsonSchema(c.p3, 'output'), { enumFilter: (path, values) => phase2Vocabulary.get(path) ?? values });
    const bodies = [...(fixtures ?? []), ...synthetic];
    expect(bodies.length, `${c.name}: no response body to prove`).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(parseFailure(c.p3, body), `${c.name}: not a valid Phase-3 response`).toBeNull();
      expect(parseFailure(c.p2, body), `${c.name}: the Phase-2 parser rejects a Phase-3 response`).toBeNull();
    }
  });
});

describe('COMPAT-N1 closed enums in Phase-2 response schemas', () => {
  it('no Phase-3 response adds a value to a Phase-2 closed enum outside the justified allow-list', async ({ annotate }) => {
    const compared = RESPONSE_CASES.flatMap((c) => responseReport(c).enums.map((e) => ({ ...e, key: `${c.name} ${e.path}` })));
    expect(compared.length).toBeGreaterThan(0);
    const widened = compared.filter((e) => e.added.length > 0);
    const allowed = new Set(EXTENSIBLE_RESPONSE_ENUMS.map((e) => e.key));
    expect(
      widened.filter((e) => !allowed.has(e.key)).map((e) => e.key),
      'closed enum widened',
    ).toEqual([]);
    // an allow-list entry that no longer matches a widening is stale and must be removed
    expect([...allowed].filter((k) => !widened.some((e) => e.key === k))).toEqual([]);
    for (const e of EXTENSIBLE_RESPONSE_ENUMS) expect(e.justification.length).toBeGreaterThan(50);
    await annotate(
      `COMPAT-N1: ${String(compared.length)} enum positions compared across ${String(RESPONSE_CASES.length)} shared responses ` +
        `(${String(SHARED.length)} shared routes); allow-listed widenings: ${widened.map((e) => `${e.key} +${JSON.stringify(e.added)}`).join('; ')}`,
    );
  });

  it('the allow-listed staff-role widening is real: the Phase-2 parser rejects a Phase-3 role (lockstep web-ops only)', () => {
    for (const [schema, body] of [
      [RESPONSE_CASES.find((c) => c.name === 'staffMe 200')!, staffMe('PRICING_MANAGER')],
      [RESPONSE_CASES.find((c) => c.name === 'staffRoster 200')!, staffRoster('RELEASE_MANAGER')],
    ] as const) {
      expect(parseFailure(schema.p3, body)).toBeNull();
      expect(schema.p2.safeParse(body).success).toBe(false);
    }
  });
});

describe('COMPAT-N1 shared-route requests: Phase-2 requests still validate, strictness is kept', () => {
  type Part = 'body' | 'query' | 'params';
  const partOf = (r: Route, part: Part): z.ZodType | undefined => (part === 'body' ? r.request : part === 'query' ? r.query : r.params);
  const REQUEST_CASES = SHARED.flatMap(({ p2, p3 }) =>
    (['body', 'query', 'params'] as const).flatMap((part) => {
      const s2 = partOf(p2, part);
      const s3 = partOf(p3, part);
      return s2 || s3 ? [[`${p2.operationId} ${part}`, { part, s2, s3 }] as const] : [];
    }),
  );

  it('there are shared requests to prove', () => {
    expect(REQUEST_CASES.length).toBeGreaterThan(0);
  });

  it.each(REQUEST_CASES)('%s', (name, { part, s2, s3 }) => {
    expect(s2, `${name}: Phase 3 added a request ${part} to a shared route`).toBeDefined();
    expect(s3, `${name}: Phase 3 dropped the request ${part} of a shared route`).toBeDefined();
    if (!s2 || !s3) return;
    const j2 = toJsonSchema(s2, 'input');
    const j3 = toJsonSchema(s3, 'input');
    expect(checkAccepts(j2, j3).violations, `${name}: a Phase-2 request the Phase-3 server may reject`).toEqual([]);
    const strict3 = strictObjectPaths(j3);
    expect(
      [...strictObjectPaths(j2)].filter((p) => !strict3.has(p)),
      `${name}: a strict Phase-2 request object is no longer strict`,
    ).toEqual([]);

    const candidates = [...(REQUEST_FIXTURES[name] ?? []), ...generateSamples(j2, { scalarsAsStrings: part !== 'body' })];
    const phase2Requests = candidates.filter((r) => s2.safeParse(r).success);
    expect(phase2Requests.length, `${name}: no valid Phase-2 request sample — add one to REQUEST_FIXTURES`).toBeGreaterThan(0);
    for (const request of phase2Requests) {
      expect(parseFailure(s3, request), `${name}: Phase 3 rejects a valid Phase-2 request`).toBeNull();
      if (typeof request === 'object' && request !== null && !Array.isArray(request)) {
        const probe = { ...request, compatProbeUnknownKey: 'x' };
        if (!s2.safeParse(probe).success) expect(s3.safeParse(probe).success, `${name}: Phase 3 accepts an unknown key Phase 2 refused`).toBe(false);
      }
    }
  });
});

describe('COMPAT-N1 error envelope and ERROR_CODES', () => {
  const NEW_CODES = ERROR_CODES.filter((c) => !(P2_ERROR_CODES as readonly string[]).includes(c));

  it('ERROR_CODES is append-only: the Phase-2 list is an unchanged prefix of the Phase-3 list', () => {
    expect(ERROR_CODES.slice(0, P2_ERROR_CODES.length)).toEqual([...P2_ERROR_CODES]);
    expect(NEW_CODES).toEqual(ERROR_CODES.slice(P2_ERROR_CODES.length));
  });

  it('structurally, the only Phase-3 envelope change a Phase-2 parser rejects is a new code (allow-listed, see ERROR_CODE_PATH)', () => {
    const report = checkAccepts(toJsonSchema(ErrorEnvelopeSchema, 'output'), toJsonSchema(P2ErrorEnvelopeSchema, 'input'), {
      extensibleEnumPaths: new Set([ERROR_CODE_PATH]),
    });
    expect(report.violations).toEqual([]);
    expect(report.enums.find((e) => e.path === ERROR_CODE_PATH)?.added).toEqual(NEW_CODES);
    expect(report.additiveFields).toContain('$.error.details.nextOpenAt');
  });

  it('the Phase-2 envelope parses Phase-3 envelopes of every Phase-2 code, including additive details', () => {
    for (const code of P2_ERROR_CODES) {
      const body = {
        error: {
          code,
          message: 'Synthetic message',
          requestId: 'req-12345678',
          details: { retryAfterSeconds: 30, reasonCodes: ['SYNTHETIC_REASON'], nextOpenAt: AT },
        },
      };
      expect(parseFailure(ErrorEnvelopeSchema, body)).toBeNull();
      expect(parseFailure(P2ErrorEnvelopeSchema, body), code).toBeNull();
    }
  });

  it('a Phase-3 code fails the closed Phase-2 envelope parse as a whole (Phase-2 clients fall back to the HTTP status)', () => {
    expect(NEW_CODES.length).toBeGreaterThan(0);
    for (const code of NEW_CODES) {
      const body = { error: { code, message: 'Synthetic message', requestId: 'req-12345678' } };
      expect(parseFailure(ErrorEnvelopeSchema, body)).toBeNull();
      expect(P2ErrorEnvelopeSchema.safeParse(body).success, code).toBe(false);
    }
  });
});

describe('COMPAT-N1 checker self-test (a green run above must be able to fail)', () => {
  const accepts = (producer: z.ZodType, consumer: z.ZodType): readonly string[] =>
    checkAccepts(toJsonSchema(producer, 'output'), toJsonSchema(consumer, 'input')).violations;

  it('flags strict consumers, widened enums, loosened requirements, type, pattern and bound changes', () => {
    expect(accepts(z.object({ a: z.string(), b: z.string() }), z.strictObject({ a: z.string() }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.string(), b: z.string() }), z.object({ a: z.string() }))).toEqual([]);
    expect(accepts(z.object({ e: z.enum(['A', 'B', 'C']) }), z.object({ e: z.enum(['A', 'B']) }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.string().optional() }), z.object({ a: z.string() }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.string().nullable() }), z.object({ a: z.string() }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.number() }), z.object({ a: z.number().int() }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.string().regex(/^[a-z]+$/) }), z.object({ a: z.string().regex(/^[a-c]+$/) }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.number().int().max(10) }), z.object({ a: z.number().int().max(5) }))).toHaveLength(1);
    expect(accepts(z.object({ a: z.array(z.literal('X')) }), z.object({ a: z.array(z.string().regex(/^[A-Z]$/)) }))).toEqual([]);
  });

  it('refuses keywords, formats and patterns it does not understand instead of passing them', () => {
    const notSchema: JsonSchema = { type: 'object', not: { required: ['a'] } };
    expect(() => checkAccepts(toJsonSchema(z.object({ a: z.string() }), 'output'), notSchema)).toThrow(/unsupported JSON Schema keyword "not"/);
    expect(() => generateSamples({ type: 'string', pattern: '^Q{7}$' })).toThrow(/no synthetic sample matches pattern/);
    expect(() => generateSamples({ type: 'string', format: 'ipv6' })).toThrow(/no synthetic sample for format/);
  });

  it('strict request objects are found at every level', () => {
    const paths = strictObjectPaths(toJsonSchema(z.strictObject({ a: z.array(z.strictObject({ b: z.string() })), c: z.object({}) }), 'input'));
    expect([...paths].sort()).toEqual(['$', '$.a[]']);
  });
});
