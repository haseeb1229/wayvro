/**
 * P2.10 Google/Apple OIDC as an OPTIONAL linked convenience (auth design §7; K15/K16/S13; ADR-040). Phone OTP stays the
 * credential: OIDC never creates an account, e-mail is never a lookup or merge key, and a sign-in on an unknown device
 * must step up on the phone (`PHONE_STEP_UP`, founder Q-02). Every route is behind `platform.auth-oidc-google` /
 * `platform.auth-oidc-apple` (OFF outside the automated test environment) and answers 503 without the provider keys.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';
import { DEVICE_PLATFORMS, InstallationIdSchema, SessionCreatedSchema } from './identity.js';

const IsoDateTime = z.iso.datetime({ offset: true });
const E = ErrorEnvelopeSchema;

export const OIDC_PROVIDERS = ['GOOGLE', 'APPLE'] as const;
export const OidcProviderSchema = z.enum(OIDC_PROVIDERS);
/** A compact JWS (three base64url parts); never logged. */
const IdTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  .max(8192);

/** A server-issued single-use nonce (5 minutes) for the provider's native sign-in. */
export const OidcNonceSchema = z.object({ nonceId: z.uuid(), nonce: z.string().min(32).max(64), expiresAt: IsoDateTime }).meta({ id: 'OidcNonce' });
export const OidcSignInNonceRequestSchema = z.strictObject({ installationId: InstallationIdSchema }).meta({ id: 'OidcSignInNonceRequest' });
export const OidcAccountNonceRequestSchema = z.strictObject({ purpose: z.enum(['LINK', 'RECOVERY']) }).meta({ id: 'OidcAccountNonceRequest' });

export const OidcProofSchema = z.strictObject({ provider: OidcProviderSchema, idToken: IdTokenSchema, nonceId: z.uuid() }).meta({ id: 'OidcProof' });

export const OidcSessionRequestSchema = z
  .strictObject({
    provider: OidcProviderSchema,
    idToken: IdTokenSchema,
    nonceId: z.uuid(),
    installationId: InstallationIdSchema,
    device: z.strictObject({ platform: z.enum(DEVICE_PLATFORMS), appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/) }),
  })
  .meta({ id: 'OidcSessionRequest' });

export const OidcLinkSchema = z.object({ id: z.uuid(), provider: OidcProviderSchema, linkedAt: IsoDateTime }).meta({ id: 'OidcLink' });
export const OidcLinkListSchema = z.object({ links: z.array(OidcLinkSchema) }).meta({ id: 'OidcLinkList' });
export const OidcLinkParamSchema = z.strictObject({ id: z.uuid() });

export const OIDC_ROUTES = [
  {
    operationId: 'createOidcSignInNonce',
    method: 'POST',
    path: '/v1/auth/oidc-nonces',
    summary: 'A single-use nonce (5 min, bound to the installation) for a Google/Apple sign-in.',
    auth: 'public',
    request: OidcSignInNonceRequestSchema,
    responses: { 201: OidcNonceSchema, 400: E, 404: E, 429: E },
  },
  {
    operationId: 'createOidcSession',
    method: 'POST',
    path: '/v1/auth/oidc-sessions',
    summary: 'Sign in with a LINKED Google/Apple identity (never creates an account; unknown device ⇒ PHONE_STEP_UP).',
    auth: 'public',
    request: OidcSessionRequestSchema,
    responses: { 201: SessionCreatedSchema, 400: E, 401: E, 404: E, 429: E, 503: E },
  },
  {
    operationId: 'createOidcAccountNonce',
    method: 'POST',
    path: '/v1/account/oidc-nonces',
    summary: 'A single-use nonce bound to the calling session, for linking or for a lost-phone recovery proof.',
    auth: 'session',
    request: OidcAccountNonceRequestSchema,
    responses: { 201: OidcNonceSchema, 400: E, 401: E, 403: E, 404: E },
  },
  {
    operationId: 'listOidcLinks',
    method: 'GET',
    path: '/v1/account/oidc-links',
    summary: 'The Google/Apple identities linked to the calling account.',
    auth: 'session',
    responses: { 200: OidcLinkListSchema, 401: E },
  },
  {
    operationId: 'createOidcLink',
    method: 'POST',
    path: '/v1/account/oidc-links',
    summary: 'Link a Google/Apple identity (fresh phone step-up; an identity linked elsewhere is a generic conflict).',
    auth: 'session',
    request: OidcProofSchema,
    responses: { 201: OidcLinkSchema, 400: E, 401: E, 403: E, 404: E, 409: E, 503: E },
  },
  {
    operationId: 'deleteOidcLink',
    method: 'DELETE',
    path: '/v1/account/oidc-links/{id}',
    summary: 'Unlink a Google/Apple identity (fresh phone step-up; the phone stays the credential).',
    auth: 'session',
    params: OidcLinkParamSchema,
    responses: { 204: null, 401: E, 403: E, 404: E, 409: E },
  },
] as const satisfies readonly RouteContract[];
