import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  AccountSummaryRequestSchema,
  AppealCreateRequestSchema,
  SupportSessionRevocationRequestSchema,
  AccountRecoveryRequestSchema,
  OidcProofSchema,
  OidcSessionRequestSchema,
  AgeDeclarationRequestSchema,
  AgePolicyDraftRequestSchema,
  StaffInvitationRequestSchema,
  ConsentRequestSchema,
  LEGAL_ROUTES,
  ErrorEnvelopeSchema,
  OtpChallengeRequestSchema,
  ProfileUpdateRequestSchema,
  SessionCreateRequestSchema,
  SessionRevocationRequestSchema,
  IdempotencyKeySchema,
  LivenessSchema,
  RealtimeEventEnvelopeSchema,
  ReadinessSchema,
  RequestIdSchema,
  SessionHelloSchema,
  buildOpenApiDocument,
} from './index.js';

describe('health contract', () => {
  it('accepts valid bodies and rejects drift', () => {
    expect(LivenessSchema.safeParse({ status: 'ok', service: 'api', version: 'dev', serverTime: new Date().toISOString() }).success).toBe(true);
    expect(LivenessSchema.safeParse({ status: 'up', service: 'api', version: 'dev', serverTime: 'yesterday' }).success).toBe(false);
    expect(ReadinessSchema.safeParse({ status: 'not_ready', checks: { database: 'fail', redis: 'ok' } }).success).toBe(true);
    expect(ReadinessSchema.safeParse({ status: 'ready', checks: { database: 'degraded' } }).success).toBe(false);
  });
});

describe('error envelope', () => {
  it('only allows registered codes', () => {
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'WAYVRO_E_NOT_FOUND', message: 'Not found', requestId: 'req-12345678' } }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'E_RANDOM', message: 'x', requestId: 'r' } }).success).toBe(false);
  });
});

describe('error envelope details (additive)', () => {
  it('accepts an optional retryAfterSeconds and nothing else', () => {
    const base = { code: 'WAYVRO_E_RATE_LIMITED', message: 'Slow down', requestId: 'req-12345678' };
    expect(ErrorEnvelopeSchema.safeParse({ error: { ...base, details: { retryAfterSeconds: 30 } } }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { ...base, details: { retryAfterSeconds: 0 } } }).success).toBe(false);
  });
});

describe('identity request contracts are strict (no mass assignment)', () => {
  const otp = { phone: '03000000001', purpose: 'SIGN_IN', installationId: 'synthetic-installation-0001', locale: 'ur' };
  it('accepts the documented shape and rejects server-owned or unknown fields', () => {
    expect(OtpChallengeRequestSchema.safeParse(otp).success).toBe(true);
    for (const extra of [{ accountId: 'x' }, { role: 'DRIVER' }, { mode: 'driver' }, { isAdmin: true }]) {
      expect(OtpChallengeRequestSchema.safeParse({ ...otp, ...extra }).success).toBe(false);
    }
    expect(OtpChallengeRequestSchema.safeParse({ ...otp, purpose: 'ACCOUNT_RECOVERY' }).success).toBe(false);
    const session = {
      challengeId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b',
      code: '048213',
      installationId: otp.installationId,
      device: { platform: 'ANDROID', appVersion: '1.0.0' },
    };
    expect(SessionCreateRequestSchema.safeParse(session).success).toBe(true);
    expect(SessionCreateRequestSchema.safeParse({ ...session, code: '48213' }).success).toBe(false);
    expect(SessionCreateRequestSchema.safeParse({ ...session, device: { ...session.device, trusted: true } }).success).toBe(false);
    expect(SessionRevocationRequestSchema.safeParse({ scope: 'ALL_OTHERS' }).success).toBe(true);
    expect(SessionRevocationRequestSchema.safeParse({ scope: 'EVERYONE' }).success).toBe(false);
  });

  it('profile updates are allowlisted, non-empty and reject control/bidi-override characters', () => {
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: '  Ayesha  ' }).data).toEqual({ displayName: 'Ayesha' });
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: 'علی' }).success).toBe(true);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: null }).success).toBe(true);
    expect(ProfileUpdateRequestSchema.safeParse({ preferredLocale: 'ur-Latn' }).success).toBe(true);
    expect(ProfileUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: 'x'.repeat(61) }).success).toBe(false);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: 'a\u0007b' }).success).toBe(false);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: 'abc\u202Edef' }).success).toBe(false);
    expect(ProfileUpdateRequestSchema.safeParse({ displayName: 'x', status: 'ACTIVE' }).success).toBe(false);
  });
});

describe('header shapes', () => {
  it('validates request ids and idempotency keys', () => {
    expect(RequestIdSchema.safeParse('01J9ZK3A7Q2M').success).toBe(true);
    expect(RequestIdSchema.safeParse('bad id with spaces').success).toBe(false);
    expect(RequestIdSchema.safeParse('x'.repeat(65)).success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('7b0c2f1e-5d8a-4c1b-9e7d-3a2b1c0d9e8f').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('short').success).toBe(false);
  });
});

describe('realtime recovery contract', () => {
  it('describes the hello and versioned event envelopes', () => {
    expect(
      SessionHelloSchema.safeParse({ type: 'session.hello', protocolVersion: 1, serverTime: new Date().toISOString(), resync: 'fetch-snapshot' }).success,
    ).toBe(true);
    expect(
      RealtimeEventEnvelopeSchema.safeParse({
        type: 'platform.heartbeat.v1',
        aggregate: { kind: 'session', id: 's1' },
        version: 3,
        emittedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(RealtimeEventEnvelopeSchema.safeParse({ type: 'NoVersion', aggregate: { kind: 'x', id: '1' }, version: -1, emittedAt: 'now' }).success).toBe(false);
  });
});

describe('OpenAPI generation', () => {
  it('emits every registered route with its response schemas', () => {
    const doc = buildOpenApiDocument('1.0.0') as {
      openapi: string;
      paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
    };
    expect(doc.openapi).toBe('3.1.0');
    for (const route of API_ROUTES) {
      const op = doc.paths[route.path]?.[route.method.toLowerCase()];
      expect(op?.operationId).toBe(route.operationId);
      expect(Object.keys(op?.responses ?? {}).sort()).toEqual(Object.keys(route.responses).sort());
    }
  });

  it('documents request bodies, path parameters, bearer security and body-less 204s', () => {
    const doc = buildOpenApiDocument('1.0.0') as {
      paths: Record<
        string,
        Record<
          string,
          { security: unknown[]; parameters: Array<{ name: string; in: string }>; requestBody?: unknown; responses: Record<string, { content?: unknown }> }
        >
      >;
      components: { securitySchemes: Record<string, unknown> };
    };
    const resend = doc.paths['/v1/auth/otp-challenges/{challengeId}/resends']?.['post'];
    expect(resend?.parameters).toContainEqual(expect.objectContaining({ name: 'challengeId', in: 'path' }));
    expect(resend?.requestBody).toBeDefined();
    expect(resend?.security).toEqual([]);
    const revoke = doc.paths['/v1/account/sessions/{sessionId}']?.['delete'];
    expect(revoke?.security).toEqual([{ sessionBearer: [] }]);
    expect(revoke?.responses['204']?.content).toBeUndefined();
    expect(doc.components.securitySchemes['sessionBearer']).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('requires an Idempotency-Key on mutating routes and merges methods on one path', () => {
    const doc = buildOpenApiDocument('1.0.0', [
      ...API_ROUTES,
      {
        operationId: 'postProbe',
        method: 'POST',
        path: '/v1/health/live',
        summary: 'test-only route',
        auth: 'public',
        responses: { 201: LivenessSchema, 400: ErrorEnvelopeSchema },
      },
    ]) as {
      paths: Record<string, Record<string, { parameters: Array<{ name: string; required: boolean }>; responses: Record<string, { description: string }> }>>;
    };
    const path = doc.paths['/v1/health/live'];
    expect(Object.keys(path ?? {}).sort()).toEqual(['get', 'post']);
    expect(path?.['post']?.parameters).toContainEqual(expect.objectContaining({ name: 'idempotency-key', required: true }));
    expect(path?.['get']?.parameters.some((p) => p.name === 'idempotency-key')).toBe(false);
    expect(path?.['post']?.responses['400']?.description).toBe('Error');
  });

  // Two full generations of the (Phase-3-sized) spec: ~2-3 s each under coverage instrumentation, so 5 s is too tight.
  it('is deterministic', { timeout: 30_000 }, () => {
    expect(JSON.stringify(buildOpenApiDocument('1.0.0'))).toBe(JSON.stringify(buildOpenApiDocument('1.0.0')));
  });
});

describe('P2.2 legal contracts', () => {
  it('age declarations carry exactly one of affirmed or dateOfBirth and never unknown fields', () => {
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1, affirmed: true }).success).toBe(true);
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1, dateOfBirth: '1990-01-31' }).success).toBe(true);
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1 }).success).toBe(false);
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1, affirmed: true, dateOfBirth: '1990-01-31' }).success).toBe(false);
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1, affirmed: false }).success).toBe(false);
    expect(AgeDeclarationRequestSchema.safeParse({ policyVersion: 1, affirmed: true, accountId: 'x' }).success).toBe(false);
  });

  it('consents bind a policy version to a lower-case SHA-256 hex digest', () => {
    const ok = { policyKey: 'TERMS', version: 1, locale: 'en', contentSha256: 'a'.repeat(64), action: 'ACCEPTED' };
    expect(ConsentRequestSchema.safeParse(ok).success).toBe(true);
    expect(ConsentRequestSchema.safeParse({ ...ok, contentSha256: 'A'.repeat(64) }).success).toBe(false);
    expect(ConsentRequestSchema.safeParse({ ...ok, locale: 'ur-Latn' }).success).toBe(false);
    expect(ConsentRequestSchema.safeParse({ ...ok, policyKey: 'NOPE' }).success).toBe(false);
  });

  it('the generated OpenAPI document exposes the locale query parameter and every legal route', () => {
    const doc = buildOpenApiDocument('test') as {
      paths: Record<string, Record<string, { parameters: Array<{ name: string; in: string; required: boolean }> }>>;
    };
    const list = doc.paths['/v1/legal/policies']?.['get'];
    expect(list?.parameters).toContainEqual(expect.objectContaining({ name: 'locale', in: 'query', required: false }));
    for (const r of LEGAL_ROUTES) expect(doc.paths[r.path]?.[r.method.toLowerCase()]).toBeDefined();
  });
});

describe('staff and compliance-admin request schemas', () => {
  it('requires a rider minimum age unless the declaration mode is NONE (arbitrary synthetic numbers — not a policy, EG-23)', () => {
    const base = { driverMinimumAge: 77, guardianRulesRef: null, approvalRef: 'COUNSEL-MEMO-SYNTHETIC', effectiveAt: '2026-11-01T00:00:00Z' };
    expect(AgePolicyDraftRequestSchema.safeParse({ ...base, riderDeclarationMode: 'AFFIRM_MINIMUM_AGE', riderMinimumAge: null }).success).toBe(false);
    expect(AgePolicyDraftRequestSchema.safeParse({ ...base, riderDeclarationMode: 'NONE', riderMinimumAge: null }).success).toBe(true);
    expect(AgePolicyDraftRequestSchema.safeParse({ ...base, riderDeclarationMode: 'AFFIRM_MINIMUM_AGE', riderMinimumAge: 66 }).success).toBe(true);
  });

  it('normalises staff invitation e-mail addresses to lower case', () => {
    const parsed = StaffInvitationRequestSchema.parse({ displayName: 'Synthetic Reviewer', workEmail: 'Reviewer@Example.TEST' });
    expect(parsed.workEmail).toBe('reviewer@example.test');
  });
});

describe('P2.9/P2.10 account-security request schemas', () => {
  const oidc = { provider: 'GOOGLE', idToken: 'aaa.bbb.ccc', nonceId: '0190b000-0000-7000-8000-000000000001' };
  it('LINKED_OIDC recovery carries a token and only it does', () => {
    expect(AccountRecoveryRequestSchema.safeParse({ proof: 'LINKED_OIDC', previousPhone: '03001234567', oidc }).success).toBe(true);
    expect(AccountRecoveryRequestSchema.safeParse({ proof: 'LINKED_OIDC', previousPhone: '03001234567' }).success).toBe(false);
    expect(AccountRecoveryRequestSchema.safeParse({ proof: 'DRIVER_KYC', previousPhone: '03001234567', oidc }).success).toBe(false);
    expect(AccountRecoveryRequestSchema.safeParse({ proof: 'DRIVER_KYC', previousPhone: '03001234567' }).success).toBe(true);
  });

  it('OIDC requests accept only compact JWS tokens and strict bodies', () => {
    expect(OidcProofSchema.safeParse(oidc).success).toBe(true);
    expect(OidcProofSchema.safeParse({ ...oidc, idToken: 'not a token' }).success).toBe(false);
    expect(OidcProofSchema.safeParse({ ...oidc, email: 'x@example.test' }).success).toBe(false);
    const session = {
      provider: 'APPLE',
      idToken: 'aaa.bbb.ccc',
      nonceId: oidc.nonceId,
      installationId: 'inst-0123456789abcdef',
      device: { platform: 'IOS', appVersion: '1.0.0' },
    };
    expect(OidcSessionRequestSchema.safeParse(session).success).toBe(true);
    expect(OidcSessionRequestSchema.safeParse({ ...session, accountId: oidc.nonceId }).success).toBe(false);
  });
});

describe('Phase-2 closure request schemas', () => {
  const id = '0190f0a0-0000-7000-8000-000000000001';
  it('a support summary names exactly one subject and always a reason', () => {
    expect(AccountSummaryRequestSchema.safeParse({ phone: '+923001234567', reasonCode: 'SAFETY_REPORT' }).success).toBe(true);
    expect(AccountSummaryRequestSchema.safeParse({ accountId: id, reasonCode: 'RECOVERY_ASSISTANCE' }).success).toBe(true);
    expect(AccountSummaryRequestSchema.safeParse({ phone: '+923001234567', accountId: id, reasonCode: 'SAFETY_REPORT' }).success).toBe(false);
    expect(AccountSummaryRequestSchema.safeParse({ reasonCode: 'SAFETY_REPORT' }).success).toBe(false);
    expect(AccountSummaryRequestSchema.safeParse({ accountId: id }).success).toBe(false);
    expect(AccountSummaryRequestSchema.safeParse({ accountId: id, reasonCode: 'CURIOSITY' }).success).toBe(false);
  });
  it('an on-behalf revocation names a session for ONE and only for ONE', () => {
    expect(SupportSessionRevocationRequestSchema.safeParse({ scope: 'ONE', sessionId: id, reasonCode: 'FRAUD_INVESTIGATION' }).success).toBe(true);
    expect(SupportSessionRevocationRequestSchema.safeParse({ scope: 'ALL', reasonCode: 'FRAUD_INVESTIGATION' }).success).toBe(true);
    expect(SupportSessionRevocationRequestSchema.safeParse({ scope: 'ONE', reasonCode: 'FRAUD_INVESTIGATION' }).success).toBe(false);
    expect(SupportSessionRevocationRequestSchema.safeParse({ scope: 'ALL', sessionId: id, reasonCode: 'FRAUD_INVESTIGATION' }).success).toBe(false);
  });
  it('an appeal names exactly one subject (a review decision, incl. a rejected renewal, or a restriction)', () => {
    const statement = 'A synthetic appeal statement.';
    expect(AppealCreateRequestSchema.safeParse({ reviewDecisionId: id, statement }).success).toBe(true);
    expect(AppealCreateRequestSchema.safeParse({ restrictionId: id, statement }).success).toBe(true);
    expect(AppealCreateRequestSchema.safeParse({ reviewDecisionId: id, restrictionId: id, statement }).success).toBe(false);
    expect(AppealCreateRequestSchema.safeParse({ statement }).success).toBe(false);
  });
});
