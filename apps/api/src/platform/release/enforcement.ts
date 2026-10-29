/**
 * Server enforcement of the app version policy and maintenance (A01/Q31; ADR-049; PHASE3_ARCHITECTURE §9.3).
 * Registered as a Fastify `onRequest` hook right after the request-id hook (see http/hooks.ts), so it runs before body
 * parsing, the Idempotency-Key check and authorisation:
 *
 *   1. app-version gate — the request carries `x-wayvro-platform` + `x-wayvro-app-build` and that build is below the
 *      ACTIVE policy's minimum or inside a blocked range ⇒ 426 WAYVRO_E_APP_UPDATE_REQUIRED;
 *   2. maintenance — `platform.maintenance` is in its safe state (ENABLED) ⇒ 503 WAYVRO_E_MAINTENANCE with
 *      `retryAfterSeconds` (and `Retry-After`) from the expected end.
 *
 * Both use the same pure evaluation as `GET /v1/app/config` (HARD_UPDATE wins over MAINTENANCE). Always reachable
 * (EXEMPT_ROUTES): app config, health, legal reads, sign-out and token refresh, the in-app deletion path (request,
 * status, cancellation and the step-up it requires), the public web deletion path, and every staff `/v1/admin/*`
 * route (staff end maintenance). No support-contact route exists yet. Headers absent ⇒ allowed (web surfaces and
 * Phase-2 builds send none; ADR-049: allow + log signal until the first public release). The gate is a compatibility
 * control, never authorisation: a spoofed build header changes only this evaluation.
 */
import { APP_BUILD_HEADER, APP_PLATFORM_HEADER, AppBuildHeaderSchema, AppPlatformSchema } from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { FastifyRequest } from 'fastify';
import { evaluateAppPolicy, maintenanceRetryAfterSeconds, type AppClient } from './policy.js';
import type { ReleaseStateCache } from './state.js';
import type { RuntimeSwitchStore } from './switches.js';

/** Routes that stay reachable under HARD_UPDATE and MAINTENANCE ("METHOD /contract/path"). @internal exported for tests */
export const EXEMPT_ROUTES: readonly string[] = [
  'GET /v1/app/config',
  'DELETE /v1/auth/sessions/current',
  'POST /v1/auth/token-refreshes',
  'POST /v1/account/step-ups',
  'POST /v1/account/step-ups/{challengeId}/verifications',
  'POST /v1/account/deletion-requests',
  'GET /v1/account/deletion-requests/current',
  'POST /v1/account/deletion-requests/{id}/cancellation',
  'POST /v1/public/account-deletion-otp-challenges',
  'POST /v1/public/account-deletion-requests',
];
const EXEMPT = new Set(EXEMPT_ROUTES.map((r) => r.replace(/\{(\w+)\}/g, ':$1')));

/** Exempt by family: staff realm, health probes and every legal document read. @internal exported for tests */
export function isExemptRoute(method: string, route: string): boolean {
  if (route.startsWith('/v1/admin/') || route.startsWith('/v1/health/')) return true;
  if (method === 'GET' && route.startsWith('/v1/legal/')) return true;
  return EXEMPT.has(`${method} ${route}`);
}

export type AppClientHeaders = { readonly kind: 'ABSENT' } | { readonly kind: 'INVALID' } | { readonly kind: 'PRESENT'; readonly client: AppClient };

/** Reads the compatibility headers; partial or malformed headers are INVALID (never trusted, never authorising). */
export function readAppClient(headers: FastifyRequest['headers']): AppClientHeaders {
  const platform = headers[APP_PLATFORM_HEADER];
  const build = headers[APP_BUILD_HEADER];
  if (platform === undefined && build === undefined) return { kind: 'ABSENT' };
  const p = AppPlatformSchema.safeParse(platform);
  const b = AppBuildHeaderSchema.safeParse(build);
  if (!p.success || !b.success) return { kind: 'INVALID' };
  return { kind: 'PRESENT', client: { platform: p.data, build: Number(b.data) } };
}

export class ReleaseEnforcement {
  private readonly classified = new WeakMap<FastifyRequest, AppClientHeaders['kind']>();

  constructor(
    private readonly state: ReleaseStateCache,
    private readonly switches: RuntimeSwitchStore,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The refusal for this request, or null when it may proceed. Unmatched routes (404) and non-/v1 paths are never
   * gated; exempt routes are never gated.
   */
  async refusal(request: FastifyRequest): Promise<WayvroError | null> {
    const route = request.routeOptions.url;
    if (route === undefined || !route.startsWith('/v1/') || isExemptRoute(request.method, route)) return null;
    const headers = readAppClient(request.headers);
    this.classified.set(request, headers.kind);
    const snapshot = await this.state.get();
    const client = headers.kind === 'PRESENT' ? headers.client : null;
    const maintenance = this.switches.maintenanceOf(snapshot.switches);
    const result = evaluateAppPolicy({ client, policy: client ? (snapshot.policies.get(client.platform) ?? null) : null, maintenance });
    if (result.state === 'HARD_UPDATE') {
      return new WayvroError('WAYVRO_E_APP_UPDATE_REQUIRED', { details: { reasonCodes: [result.reasonClass ?? 'MINIMUM_BUILD'] } });
    }
    if (result.state === 'MAINTENANCE') {
      const retryAfterSeconds = maintenanceRetryAfterSeconds(maintenance, this.now());
      return new WayvroError('WAYVRO_E_MAINTENANCE', retryAfterSeconds === undefined ? {} : { details: { retryAfterSeconds } });
    }
    return null;
  }

  /** How the gated request identified its app (access-log field); undefined for exempt/ungated requests. */
  clientHeadersOf(request: FastifyRequest): AppClientHeaders['kind'] | undefined {
    return this.classified.get(request);
  }
}
