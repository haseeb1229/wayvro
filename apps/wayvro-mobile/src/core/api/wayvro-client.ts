import {
  AccountAppealSchema,
  AccountStateSchema,
  AgeDeclarationRecordedSchema,
  AgeEligibilityPolicySchema,
  AppConfigSchema,
  ConsentRecordedSchema,
  ConsentStatusListSchema,
  OtpChallengeSchema,
  PolicyDocumentSchema,
  PolicyListSchema,
  ProfileSchema,
  SecurityEventListSchema,
  SessionCreatedSchema,
  SessionListSchema,
  SessionRevocationResultSchema,
  SessionTokensSchema,
  type AccountState,
  type AgeDeclarationRecorded,
  type AgeDeclarationRequest,
  type AgeEligibilityPolicy,
  type AppConfig,
  type ConsentRecorded,
  type ConsentRequest,
  type ConsentStatusList,
  type Locale,
  type OtpChallenge,
  type PolicyDocument,
  type PolicyKey,
  type PolicyList,
  type ProfileUpdateRequest,
  type SecurityEventList,
  type SessionCreated,
  type SessionList,
  type SessionTokens,
} from '@wayvro/contracts';
import type { z } from 'zod';
import type { AppealRequest } from '../account/appeal';
import type { SessionManager } from '../session/session-manager';
import { ApiError } from './errors';
import { send, type HttpDeps, type HttpResult, type RequestSpec } from './http';
import { canonicalJson, type IdempotencyIntentStore } from './idempotency-intents';

/**
 * Typed Wayvro API client on the shared contracts (P2.3). Every response is validated with its contract schema in
 * `send`. Authenticated calls refresh once (single-flight, via SessionManager) on a 401 and retry once; a second 401
 * ends the session. Mutations carry a persisted per-intent idempotency key and are retried only while their outcome is
 * unknown.
 */

export type PolicyLocale = 'en' | 'ur';
export type Profile = z.infer<typeof ProfileSchema>;
export type AccountAppeal = z.infer<typeof AccountAppealSchema>;

interface DeviceInfo {
  readonly platform: 'ANDROID' | 'IOS';
  readonly appVersion: string;
}

export interface WayvroClientDeps {
  readonly http: HttpDeps;
  readonly session: SessionManager;
  readonly intents: IdempotencyIntentStore;
  readonly installationId: string;
  readonly device: DeviceInfo;
  readonly fingerprint: (canonical: string) => Promise<string>;
}

/** A request as feature modules describe it (the client adds the token, idempotency key and retry policy). */
export type ApiSpec<T> = Omit<RequestSpec<T>, 'accessToken' | 'idempotencyKey' | 'retry'>;
type Spec<T> = ApiSpec<T>;

export function createWayvroClient(deps: WayvroClientDeps) {
  const { http, session, intents, installationId } = deps;

  /** Bearer call with one single-flight refresh + one retry on 401. */
  async function authed<T>(spec: RequestSpec<T>): Promise<HttpResult<T>> {
    let token = session.accessToken();
    if (token === null) throw new ApiError('session-expired');
    // SP02-F1: a token already past its server-issued expiry at the first call of this process is refreshed first (the
    // same single-flight refresh as after a 401), saving the request that could only answer 401.
    if (session.refreshDueAtFirstUse((http.now ?? Date.now)() + http.clock.offsetMs)) {
      const early = await session.refreshAfterUnauthorized(token);
      const fresh = session.accessToken();
      if (early === 'expired' || fresh === null) throw new ApiError('session-expired');
      token = fresh;
    }
    try {
      return await send(http, { ...spec, accessToken: token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.detail.status !== 401) throw error;
    }
    const outcome = await session.refreshAfterUnauthorized(token);
    const fresh = session.accessToken();
    if (outcome === 'expired' || fresh === null) throw new ApiError('session-expired');
    try {
      return await send(http, { ...spec, accessToken: fresh });
    } catch (error) {
      if (error instanceof ApiError && error.detail.status === 401) {
        await session.clear('expired');
        throw new ApiError('session-expired', { status: 401 });
      }
      throw error;
    }
  }

  const read = async <T>(spec: Spec<T>, auth: boolean): Promise<T> =>
    (auth ? await authed({ ...spec, retry: 'none' }) : await send(http, { ...spec, retry: 'none' })).data;

  /**
   * A mutation under a persisted intent key. The intent is settled after any definitive answer (success or a server
   * error response) and kept only while the outcome is unknown, so the next attempt replays instead of re-executing.
   */
  async function mutate<T>(intent: string, spec: Spec<T>, auth: boolean): Promise<HttpResult<T>> {
    const fingerprint = await deps.fingerprint(canonicalJson({ m: spec.method, p: spec.path, b: spec.body ?? null }));
    const idempotencyKey = await intents.keyFor(intent, fingerprint);
    const full: RequestSpec<T> = { ...spec, idempotencyKey, retry: 'idempotent' };
    try {
      const result = auth ? await authed(full) : await send(http, full);
      await intents.settle(intent);
      return result;
    } catch (error) {
      if (!(error instanceof ApiError && error.detail.transient)) await intents.settle(intent);
      throw error;
    }
  }

  return {
    // ── sign-in ───────────────────────────────────────────────────────────────────────────────────────────────
    requestOtp: async (phone: string, locale: Locale): Promise<OtpChallenge> =>
      (
        await mutate(
          'otp-challenge',
          {
            method: 'POST',
            path: '/v1/auth/otp-challenges',
            body: { phone, purpose: 'SIGN_IN', installationId, locale },
            schema: OtpChallengeSchema,
          },
          false,
        )
      ).data,

    resendOtp: async (challengeId: string): Promise<OtpChallenge> =>
      (
        await mutate(
          `otp-resend:${challengeId}`,
          {
            method: 'POST',
            path: `/v1/auth/otp-challenges/${encodeURIComponent(challengeId)}/resends`,
            body: { installationId },
            schema: OtpChallengeSchema,
          },
          false,
        )
      ).data,

    /** Verifies the code and persists the new session BEFORE returning (tokens never leave the session layer). */
    verifyOtp: async (challengeId: string, code: string): Promise<Pick<SessionCreated, 'isNewAccount' | 'requiredActions'>> => {
      const created = (
        await mutate(
          `session-create:${challengeId}`,
          {
            method: 'POST',
            path: '/v1/auth/sessions',
            body: { challengeId, code, installationId, device: deps.device },
            schema: SessionCreatedSchema,
          },
          false,
        )
      ).data;
      await session.establish(created);
      return { isNewAccount: created.isNewAccount, requiredActions: created.requiredActions };
    },

    /**
     * Signs out: asks the server to end the session (best effort, bounded) and ALWAYS wipes local state, even when the
     * network call fails. `serverConfirmed` tells the UI whether the server acknowledged it.
     */
    signOut: async (): Promise<{ readonly serverConfirmed: boolean }> => {
      let serverConfirmed = false;
      if (session.accessToken() !== null) {
        try {
          await mutate('sign-out', { method: 'DELETE', path: '/v1/auth/sessions/current', schema: null }, true);
          serverConfirmed = true;
        } catch (error) {
          // 401 means the server already considers the session ended; any other failure still signs out locally.
          serverConfirmed = error instanceof ApiError && error.kind === 'session-expired';
        }
      }
      await session.clear('signed-out');
      return { serverConfirmed };
    },

    // ── account ───────────────────────────────────────────────────────────────────────────────────────────────
    accountState: (): Promise<AccountState> => read({ method: 'GET', path: '/v1/account/state', schema: AccountStateSchema }, true),

    updateProfile: async (update: ProfileUpdateRequest): Promise<Profile> =>
      (await mutate('profile-update', { method: 'PATCH', path: '/v1/account/profile', body: update, schema: ProfileSchema }, true)).data,

    sessions: (): Promise<SessionList> => read({ method: 'GET', path: '/v1/account/sessions', schema: SessionListSchema }, true),

    revokeSession: async (sessionId: string): Promise<void> => {
      await mutate(`session-revoke:${sessionId}`, { method: 'DELETE', path: `/v1/account/sessions/${encodeURIComponent(sessionId)}`, schema: null }, true);
    },

    revokeOtherSessions: async (): Promise<number> =>
      (
        await mutate(
          'session-revocations:ALL_OTHERS',
          { method: 'POST', path: '/v1/account/session-revocations', body: { scope: 'ALL_OTHERS' }, schema: SessionRevocationResultSchema },
          true,
        )
      ).data.revokedCount,

    securityEvents: (): Promise<SecurityEventList> => read({ method: 'GET', path: '/v1/account/security-events', schema: SecurityEventListSchema }, true),

    // ── release controls (Phase 3, A01/Q31) ───────────────────────────────────────────────────────────────────
    /** Public, cacheable app configuration (version policy, maintenance, presentation switches, client tuning). */
    appConfig: (): Promise<AppConfig> => read({ method: 'GET', path: '/v1/app/config', schema: AppConfigSchema }, false),

    // ── legal ─────────────────────────────────────────────────────────────────────────────────────────────────
    policies: (locale: PolicyLocale): Promise<PolicyList> =>
      read({ method: 'GET', path: '/v1/legal/policies', query: { locale }, schema: PolicyListSchema }, false),

    policyDocument: (policyKey: PolicyKey, version: number, locale: PolicyLocale): Promise<PolicyDocument> =>
      read(
        {
          method: 'GET',
          path: `/v1/legal/policies/${encodeURIComponent(policyKey)}/versions/${String(version)}`,
          query: { locale },
          schema: PolicyDocumentSchema,
        },
        false,
      ),

    agePolicy: (): Promise<AgeEligibilityPolicy> =>
      read({ method: 'GET', path: '/v1/legal/age-eligibility-policy', schema: AgeEligibilityPolicySchema }, false),

    consents: (): Promise<ConsentStatusList> => read({ method: 'GET', path: '/v1/account/consents', schema: ConsentStatusListSchema }, true),

    recordConsent: async (request: ConsentRequest): Promise<ConsentRecorded> =>
      (await mutate(`consent:${request.policyKey}`, { method: 'POST', path: '/v1/account/consents', body: request, schema: ConsentRecordedSchema }, true)).data,

    declareAge: async (request: AgeDeclarationRequest): Promise<AgeDeclarationRecorded> =>
      (await mutate('age-declaration', { method: 'POST', path: '/v1/account/age-declarations', body: request, schema: AgeDeclarationRecordedSchema }, true))
        .data,

    /** Appeal of a review decision or of an appealable restriction (K05, V13; works under a restriction). */
    createAppeal: async (request: AppealRequest): Promise<AccountAppeal> =>
      (
        await mutate(
          `appeal:${'reviewDecisionId' in request ? request.reviewDecisionId : request.restrictionId}`,
          { method: 'POST', path: '/v1/account/appeals', body: request, schema: AccountAppealSchema },
          true,
        )
      ).data,

    /**
     * Authenticated transport for lazily loaded feature modules (P2.8 Driver/Partner flows): the same bearer, refresh,
     * response validation and per-intent idempotency rules as the calls above, without the account slice having to
     * know feature endpoints.
     */
    session: {
      read: <T>(spec: ApiSpec<T>): Promise<T> => read(spec, true),
      mutate: async <T>(intent: string, spec: ApiSpec<T>): Promise<T> => (await mutate(intent, spec, true)).data,
    },
  };
}

export type WayvroClient = ReturnType<typeof createWayvroClient>;

/** The refresh call used by SessionManager (public route; retried only with the same idempotency key). */
export function createRefreshCall(http: HttpDeps) {
  return async (refreshToken: string, idempotencyKey: string): Promise<SessionTokens> =>
    (
      await send(http, {
        method: 'POST',
        path: '/v1/auth/token-refreshes',
        body: { refreshToken },
        idempotencyKey,
        retry: 'idempotent',
        schema: SessionTokensSchema,
      })
    ).data;
}
