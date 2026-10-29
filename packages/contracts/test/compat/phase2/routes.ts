// FROZEN Phase-2 consumer contract baseline: main @ b1a1986, packages/contracts/src/routes.ts (COMPAT-N1,
// docs/phase3/PHASE3_TEST_STRATEGY.md §4.10). TEST-ONLY: outside src/, so never built, exported or imported by production
// code. Copied verbatim and never edited except to fix import paths: it is what a Phase-2 client parses responses with.
/**
 * P2.1 identity/session routes (docs/phase2/PHASE2_API_AND_SURFACES.md §2.1–§2.2). Every mutating route requires an
 * Idempotency-Key and replays the original outcome for a repeated key (F-03). Public identity routes answer
 * generically: no response reveals whether an account exists or why a code failed beyond "invalid or expired".
 */
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import {
  AccountStateSchema,
  ChallengeIdParamSchema,
  OtpChallengeRequestSchema,
  OtpChallengeSchema,
  OtpResendRequestSchema,
  ProfileSchema,
  ProfileUpdateRequestSchema,
  SecurityEventListSchema,
  SessionCreateRequestSchema,
  SessionCreatedSchema,
  SessionIdParamSchema,
  SessionListSchema,
  SessionRevocationRequestSchema,
  SessionRevocationResultSchema,
  SessionTokensSchema,
  TokenRefreshRequestSchema,
} from './identity.js';

const E = ErrorEnvelopeSchema;

export const IDENTITY_ROUTES = [
  {
    operationId: 'createOtpChallenge',
    method: 'POST',
    path: '/v1/auth/otp-challenges',
    summary: 'Request a sign-in code for a +92 mobile number (identical 202 for every syntactically valid number).',
    auth: 'public',
    request: OtpChallengeRequestSchema,
    responses: { 202: OtpChallengeSchema, 400: E, 409: E, 413: E, 415: E, 429: E, 503: E },
  },
  {
    operationId: 'resendOtpChallenge',
    method: 'POST',
    path: '/v1/auth/otp-challenges/{challengeId}/resends',
    summary: 'Issue a new code for a challenge after its cooldown (supersedes the previous code).',
    auth: 'public',
    params: ChallengeIdParamSchema,
    request: OtpResendRequestSchema,
    responses: { 202: OtpChallengeSchema, 400: E, 401: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'createSession',
    method: 'POST',
    path: '/v1/auth/sessions',
    summary: 'Verify a code and create a session (creates the account on first verified sign-in).',
    auth: 'public',
    request: SessionCreateRequestSchema,
    responses: { 201: SessionCreatedSchema, 400: E, 401: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'refreshSession',
    method: 'POST',
    path: '/v1/auth/token-refreshes',
    summary: 'Rotate a single-use refresh token; reuse outside the idempotent replay window revokes the session.',
    auth: 'public',
    request: TokenRefreshRequestSchema,
    responses: { 200: SessionTokensSchema, 400: E, 401: E, 409: E, 429: E, 503: E },
  },
  {
    operationId: 'deleteCurrentSession',
    method: 'DELETE',
    path: '/v1/auth/sessions/current',
    summary: 'Sign out the calling session.',
    auth: 'session',
    responses: { 204: null, 401: E, 409: E },
  },
  {
    operationId: 'getAccountState',
    method: 'GET',
    path: '/v1/account/state',
    summary: 'Authoritative account/session/profile state for the calling session.',
    auth: 'session',
    responses: { 200: AccountStateSchema, 401: E },
  },
  {
    operationId: 'updateProfile',
    method: 'PATCH',
    path: '/v1/account/profile',
    summary: 'Update the allowlisted profile fields (display name, preferred locale).',
    auth: 'session',
    request: ProfileUpdateRequestSchema,
    responses: { 200: ProfileSchema, 400: E, 401: E, 409: E },
  },
  {
    operationId: 'listSessions',
    method: 'GET',
    path: '/v1/account/sessions',
    summary: 'Active sessions of the calling account (no IP address or location).',
    auth: 'session',
    responses: { 200: SessionListSchema, 401: E },
  },
  {
    operationId: 'revokeSession',
    method: 'DELETE',
    path: '/v1/account/sessions/{sessionId}',
    summary: 'Revoke one session of the calling account (foreign or unknown ids answer 404).',
    auth: 'session',
    params: SessionIdParamSchema,
    responses: { 204: null, 401: E, 404: E, 409: E },
  },
  {
    operationId: 'createSessionRevocation',
    method: 'POST',
    path: '/v1/account/session-revocations',
    summary: 'Revoke all sessions or all other sessions (needs a fresh OTP proof unless the session is older than 24 h).',
    auth: 'session',
    request: SessionRevocationRequestSchema,
    responses: { 200: SessionRevocationResultSchema, 400: E, 401: E, 403: E, 409: E },
  },
  {
    operationId: 'listSecurityEvents',
    method: 'GET',
    path: '/v1/account/security-events',
    summary: 'Recent security activity of the calling account.',
    auth: 'session',
    responses: { 200: SecurityEventListSchema, 401: E },
  },
] as const satisfies readonly RouteContract[];
