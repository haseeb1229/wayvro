/**
 * `GET /v1/app/config` (public, cacheable; PHASE3_ARCHITECTURE §9.2; ADR-049). Public data only — no per-user data and
 * no secret: the calling build's version/update state, maintenance, client-visible switch states, the map renderer
 * descriptor (`none` until the P3.7 freeze) and client tuning values.
 *
 * - Rate limit per IP prefix (/24, /56) in Valkey; when Valkey is unavailable an in-process fixed-window bucket per
 *   prefix takes over (no provider cost sits behind this endpoint, so it degrades instead of failing closed).
 * - PostgreSQL unreachable: the last-known state is served for up to 10 minutes, flagged stale (`x-wayvro-config-stale`
 *   and not cacheable); older or never loaded ⇒ 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE.
 * - ETag over the body without `serverTime`, so `If-None-Match` revalidation answers 304 while nothing changed.
 */
import { createHash } from 'node:crypto';
import type { AppConfig, MAP_RENDERER_KINDS } from '@wayvro/contracts';
import { WayvroError, type Logger } from '@wayvro/observability';
import { LimiterUnavailableError, type RateLimiter } from '@wayvro/server-runtime';
import { ipPrefix } from '../../identity/otp-abuse.js';
import { evaluateAppPolicy, type AppClient } from './policy.js';
import type { ReleaseStateCache } from './state.js';
import type { RuntimeSwitchStore } from './switches.js';

/** Last-known release state may be served for at most this long while the store is unreachable (§8). @internal exported for tests */
export const APP_CONFIG_STALE_LIMIT_MS = 10 * 60 * 1000;
const WINDOW_MS = 60_000;
/** Bound on the in-process fallback buckets (oldest windows are dropped first). */
const MAX_FALLBACK_BUCKETS = 10_000;

export interface AppConfigPolicy {
  readonly APP_CONFIG_PER_MINUTE_IP_PREFIX: number;
  readonly GEO_RENDERER_KIND: (typeof MAP_RENDERER_KINDS)[number];
  readonly APP_GEO_AUTOCOMPLETE_MIN_CHARS: number;
  readonly APP_GEO_AUTOCOMPLETE_DEBOUNCE_MS: number;
  readonly APP_GEO_REVERSE_DEBOUNCE_MS: number;
  readonly APP_LITE_AUTO_SUGGEST_AFTER_SLOW_REQUESTS: number;
  readonly APP_LITE_SLOW_REQUEST_MS: number;
}

export interface AppConfigResult {
  readonly body: AppConfig;
  readonly etag: string;
  readonly stale: boolean;
}

export class AppConfigService {
  private readonly fallback = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly state: ReleaseStateCache,
    private readonly switches: RuntimeSwitchStore,
    private readonly limiter: RateLimiter,
    private readonly policy: AppConfigPolicy,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Admits one request from `ip` or throws 429 RATE_LIMITED. */
  async admit(ip: string): Promise<void> {
    const prefix = ipPrefix(ip) ?? 'unparsed';
    const limit = this.policy.APP_CONFIG_PER_MINUTE_IP_PREFIX;
    try {
      const decision = await this.limiter.consume([{ key: `appcfg:ip:m:${prefix}`, limit, windowSeconds: WINDOW_MS / 1000 }]);
      if (!decision.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: decision.retryAfterSeconds } });
    } catch (e) {
      if (!(e instanceof LimiterUnavailableError)) throw e;
      this.admitInProcess(prefix, limit);
    }
  }

  private admitInProcess(prefix: string, limit: number): void {
    const now = this.now();
    let bucket = this.fallback.get(prefix);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      if (!bucket && this.fallback.size >= MAX_FALLBACK_BUCKETS) {
        const oldest = this.fallback.keys().next();
        if (!oldest.done) this.fallback.delete(oldest.value);
      }
      bucket = { windowStart: now, count: 0 };
      this.fallback.delete(prefix);
      this.fallback.set(prefix, bucket);
    }
    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000));
      throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds } });
    }
    bucket.count++;
  }

  /** The configuration for the calling app (`client` null = headers absent ⇒ evaluated as OK; ADR-049). */
  async build(client: AppClient | null): Promise<AppConfigResult> {
    const snapshot = await this.state.get();
    const now = this.now();
    if (snapshot.loadedAt === null || (snapshot.stale && now - snapshot.loadedAt > APP_CONFIG_STALE_LIMIT_MS)) {
      throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    }
    const maintenance = this.switches.maintenanceOf(snapshot.switches);
    const result = evaluateAppPolicy({ client, policy: client ? (snapshot.policies.get(client.platform) ?? null) : null, maintenance });
    const content: Omit<AppConfig, 'serverTime'> = {
      client: {
        state: result.state,
        reasonClass: result.reasonClass,
        messageKey: result.messageKey,
        storeUrlKey: result.storeUrlKey,
        recommendedBuild: result.recommendedBuild,
        minSupportedBuild: result.minSupportedBuild,
      },
      maintenance: { active: maintenance.active, messageKey: maintenance.messageKey, expectedEnd: maintenance.expectedEnd?.toISOString() ?? null },
      switches: this.switches.clientSwitchesOf(snapshot.switches),
      map: { rendererKind: this.policy.GEO_RENDERER_KIND, styleUrl: null, attributionCodes: [], clientToken: null },
      geo: {
        autocompleteMinChars: this.policy.APP_GEO_AUTOCOMPLETE_MIN_CHARS,
        autocompleteDebounceMs: this.policy.APP_GEO_AUTOCOMPLETE_DEBOUNCE_MS,
        reverseDebounceMs: this.policy.APP_GEO_REVERSE_DEBOUNCE_MS,
      },
      lite: { autoSuggestAfterSlowRequests: this.policy.APP_LITE_AUTO_SUGGEST_AFTER_SLOW_REQUESTS, slowRequestMs: this.policy.APP_LITE_SLOW_REQUEST_MS },
    };
    if (snapshot.stale)
      this.log.warn(
        { signal: 'APP_CONFIG_SERVED_STALE', ageSeconds: Math.round((now - snapshot.loadedAt) / 1000) },
        'app config served from the last-known state',
      );
    const etag = `"${createHash('sha256').update(JSON.stringify(content)).digest('base64url').slice(0, 32)}"`;
    return { body: { serverTime: new Date(now).toISOString(), ...content }, etag, stale: snapshot.stale };
  }
}

/** True when an `If-None-Match` header lists `etag` (weak comparison, `*` matches anything). */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}
