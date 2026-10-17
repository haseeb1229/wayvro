import type { AccountState, ConsentStatusList, PolicyList, SessionTokens } from '@wayvro/contracts';

/** Synthetic fixtures only (no real phone numbers, tokens or identities). */
export const IDS = {
  account: '0190a000-0000-7000-8000-000000000001',
  session: '0190a000-0000-7000-8000-000000000002',
  otherSession: '0190a000-0000-7000-8000-000000000003',
  riderProfile: '0190a000-0000-7000-8000-000000000004',
  challenge: '0190a000-0000-7000-8000-000000000005',
  event1: '0190a000-0000-7000-8000-000000000006',
  event2: '0190a000-0000-7000-8000-000000000007',
  consent: '0190a000-0000-7000-8000-000000000008',
} as const;

export const SYNTHETIC_PHONE = '+923990000001';

export function tokens(n: number): SessionTokens {
  return {
    sessionId: IDS.session,
    accessToken: `wv_at_synthetic_${String(n)}`,
    accessTokenExpiresAt: '2099-01-01T00:15:00.000Z',
    refreshToken: `wv_rt_synthetic_${String(n)}`,
    refreshTokenExpiresAt: '2026-11-10T10:00:00.000Z',
  };
}

export function accountState(
  requiredActions: AccountState['requiredActions'] = [],
  displayName: string | null = 'Test Rider',
  restrictions: AccountState['restrictions'] = [],
): AccountState {
  return {
    account: { id: IDS.account, status: 'ACTIVE', displayName, preferredLocale: 'en', createdAt: '2026-10-01T09:00:00.000Z' },
    session: { id: IDS.session, assurance: 'OTP', accessTokenExpiresAt: '2026-10-11T10:15:00.000Z' },
    riderProfile: { id: IDS.riderProfile, status: 'ACTIVE' },
    requiredActions,
    driver: { application: null, profile: null, onboardingAvailable: false },
    restrictions,
  };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

export function policyList(locale: 'en' | 'ur', overrides: Partial<Record<'TERMS' | 'PRIVACY', number>> = {}): PolicyList {
  const base = {
    locale,
    status: 'PLACEHOLDER_NOT_FOR_PRODUCTION' as const,
    effectiveAt: '2026-10-01T00:00:00.000Z',
    materialChange: false,
    changeSummary: '',
  };
  return {
    policies: [
      {
        ...base,
        policyKey: 'TERMS',
        version: overrides.TERMS ?? 1,
        title: locale === 'ur' ? 'شرائط' : 'Terms',
        contentSha256: locale === 'ur' ? HASH_C : HASH_A,
        canonicalPath: '/legal/terms/v1',
        requiredFor: ['ACCOUNT'],
      },
      {
        ...base,
        policyKey: 'PRIVACY',
        version: overrides.PRIVACY ?? 1,
        title: 'Privacy',
        contentSha256: HASH_B,
        canonicalPath: '/legal/privacy/v1',
        requiredFor: ['ACCOUNT'],
        changeSummary: 'Clarified retention.',
      },
      {
        ...base,
        policyKey: 'DRIVER_PARTNER_AGREEMENT',
        version: 1,
        title: 'Driver agreement',
        contentSha256: HASH_A,
        canonicalPath: '/legal/driver-partner-agreement/v1',
        requiredFor: ['DRIVER_APPLICATION'],
      },
      {
        ...base,
        policyKey: 'COMMUNITY_GUIDELINES',
        version: 1,
        title: 'Community guidelines',
        contentSha256: HASH_B,
        canonicalPath: '/legal/community-guidelines/v1',
        requiredFor: [],
        status: 'APPROVED',
      },
    ],
  };
}

export function consentStatuses(pending: readonly ('TERMS' | 'PRIVACY')[], acceptedVersion: number | null = null): ConsentStatusList {
  const row = (policyKey: 'TERMS' | 'PRIVACY') => ({
    policyKey,
    requiredFor: ['ACCOUNT' as const],
    currentVersion: 1,
    acceptedVersion: pending.includes(policyKey) ? acceptedVersion : 1,
    lastAction: pending.includes(policyKey) && acceptedVersion === null ? null : ('ACCEPTED' as const),
    acceptanceRequired: pending.includes(policyKey),
  });
  return {
    policies: [
      row('TERMS'),
      row('PRIVACY'),
      {
        policyKey: 'DRIVER_PARTNER_AGREEMENT',
        requiredFor: ['DRIVER_APPLICATION'],
        currentVersion: 1,
        acceptedVersion: null,
        lastAction: null,
        acceptanceRequired: true,
      },
    ],
  };
}

/** A JSON Response as fetch would return it. */
export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function errorBody(code: string, details?: { retryAfterSeconds?: number }) {
  return { error: { code, message: 'server text that must never reach the UI', requestId: 'req_synthetic_1', ...(details ? { details } : {}) } };
}
