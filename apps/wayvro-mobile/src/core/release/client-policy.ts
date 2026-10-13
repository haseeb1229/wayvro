import { AppConfigSchema, type AppConfig } from '@wayvro/contracts';
import { z } from 'zod';

/**
 * Client side of the release controls (A01/Q31; ADR-049; UX doc §9). The SERVER decides the state of this build from
 * the version headers and enforces it itself (426 / 503); the client only shows it. Everything here is pure so the
 * state table (UNIT-POLICY) is tested exhaustively.
 */

/** The part of `GET /v1/app/config` the client acts on and caches (the map descriptor and any client token are not cached). */
const PolicySnapshotSchema = z.object({
  client: AppConfigSchema.shape.client,
  maintenance: AppConfigSchema.shape.maintenance,
  switches: AppConfigSchema.shape.switches,
  geo: AppConfigSchema.shape.geo,
  lite: AppConfigSchema.shape.lite,
});
export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

export function snapshotOf(config: AppConfig): PolicySnapshot {
  return { client: config.client, maintenance: config.maintenance, switches: config.switches, geo: config.geo, lite: config.lite };
}

/** A refusal seen on ANY API call since the last successful config fetch (426 update required / 503 maintenance). */
export type ForcedState = 'UPDATE_REQUIRED' | 'MAINTENANCE' | null;

export type ClientPolicyView =
  | { readonly kind: 'ok' }
  | { readonly kind: 'soft-update'; readonly bannerVisible: boolean }
  | {
      readonly kind: 'hard-update';
      readonly reasonClass: PolicySnapshot['client']['reasonClass'];
      readonly storeUrlKey: string | null;
    }
  | { readonly kind: 'maintenance'; readonly messageKey: string | null; readonly expectedEnd: string | null };

export interface PolicyInput {
  /** Last known policy (fresh or cached); null when none was ever loaded on this installation. */
  readonly snapshot: PolicySnapshot | null;
  /** Installed native build; null when unknown (then only the server's state counts). */
  readonly build: number | null;
  readonly forced: ForcedState;
  readonly softDismissedAt: number | null;
  readonly now: number;
}

/** The soft-update banner shows at most once per 24 h after a dismissal. @internal exported for unit tests */
export const SOFT_BANNER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Order: HARD_UPDATE (a required update outlives any maintenance window) → MAINTENANCE (overrides SOFT) → SOFT_UPDATE
 * → OK. Without any policy and without a forced refusal the app proceeds (offline first start: the server enforces on
 * the next call). The build-number checks mirror the server's evaluation and can only make the result stricter.
 */
export function evaluateClientPolicy(input: PolicyInput): ClientPolicyView {
  const { snapshot, build, forced } = input;
  const client = snapshot?.client ?? null;
  const minimum = client?.minSupportedBuild ?? null;
  const belowMinimum = build !== null && minimum !== null && build < minimum;
  if (forced === 'UPDATE_REQUIRED' || client?.state === 'HARD_UPDATE' || belowMinimum) {
    return {
      kind: 'hard-update',
      reasonClass: client?.reasonClass ?? (belowMinimum ? 'MINIMUM_BUILD' : null),
      storeUrlKey: client?.storeUrlKey ?? null,
    };
  }
  if (forced === 'MAINTENANCE' || client?.state === 'MAINTENANCE' || snapshot?.maintenance.active === true) {
    return { kind: 'maintenance', messageKey: snapshot?.maintenance.messageKey ?? null, expectedEnd: snapshot?.maintenance.expectedEnd ?? null };
  }
  const recommended = client?.recommendedBuild ?? null;
  const belowRecommended = build !== null && recommended !== null && build < recommended;
  if (client?.state === 'SOFT_UPDATE' || belowRecommended) {
    const dismissed = input.softDismissedAt;
    return { kind: 'soft-update', bannerVisible: dismissed === null || input.now - dismissed >= SOFT_BANNER_INTERVAL_MS };
  }
  return { kind: 'ok' };
}

export const isBlocking = (view: ClientPolicyView): boolean => view.kind === 'hard-update' || view.kind === 'maintenance';

/**
 * Escape hatches under a blocking state (UX doc §9): the legal policies stay readable in both states, and account
 * deletion stays reachable under HARD_UPDATE (its endpoints are exempt from 426). Every other path shows the blocking
 * screen — the gate sits above the router, so no route can bypass it.
 */
export function isEscapePath(view: ClientPolicyView, pathname: string): boolean {
  const legal = pathname === '/legal' || pathname.startsWith('/legal/');
  if (view.kind === 'hard-update') return legal || pathname === '/account/delete';
  if (view.kind === 'maintenance') return legal;
  return true;
}

/** Foreground refetches of the policy happen at most once per 15 minutes; start and explicit retries always fetch. */
const FOREGROUND_REFETCH_MS = 15 * 60 * 1000;
export type FetchTrigger = 'start' | 'foreground' | 'retry';

export function shouldFetchPolicy(trigger: FetchTrigger, lastFetchAt: number | null, now: number): boolean {
  if (trigger !== 'foreground') return true;
  return lastFetchAt === null || now - lastFetchAt >= FOREGROUND_REFETCH_MS;
}

const MAINTENANCE_FIRST_RETRY_MS = 30_000;
const MAINTENANCE_MAX_RETRY_MS = 5 * 60_000;

/** Automatic maintenance re-checks: 30 s, 60 s, 120 s, 240 s, then every 5 min (no retry storm). `attempt` is 0-based. */
export function maintenanceRetryDelayMs(attempt: number): number {
  return Math.min(MAINTENANCE_MAX_RETRY_MS, MAINTENANCE_FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(attempt, 10)));
}

/** Client tuning with the UX-doc defaults when no policy was ever loaded. */
export interface ClientTuning {
  readonly autocompleteMinChars: number;
  readonly autocompleteDebounceMs: number;
  readonly reverseDebounceMs: number;
  readonly liteSlowRequestMs: number;
  readonly liteSuggestAfterSlowRequests: number;
}

/** @internal exported for unit tests */
export const DEFAULT_TUNING: ClientTuning = {
  autocompleteMinChars: 3,
  autocompleteDebounceMs: 300,
  reverseDebounceMs: 600,
  liteSlowRequestMs: 4000,
  liteSuggestAfterSlowRequests: 3,
};

export function tuningOf(snapshot: PolicySnapshot | null): ClientTuning {
  if (snapshot === null) return DEFAULT_TUNING;
  return {
    autocompleteMinChars: snapshot.geo.autocompleteMinChars,
    autocompleteDebounceMs: snapshot.geo.autocompleteDebounceMs,
    reverseDebounceMs: snapshot.geo.reverseDebounceMs,
    liteSlowRequestMs: snapshot.lite.slowRequestMs,
    liteSuggestAfterSlowRequests: snapshot.lite.autoSuggestAfterSlowRequests,
  };
}

/**
 * Presentation state of a runtime switch. Unknown/absent switches are treated as ENABLED for display only: the server
 * enforces every switch itself and refuses with WAYVRO_E_FEATURE_DISABLED, which the screens show honestly.
 */
export function switchDisabled(snapshot: PolicySnapshot | null, key: string): boolean {
  return snapshot?.switches.some((s) => s.key === key && s.state === 'DISABLED') ?? false;
}

/** Persisted cache `wayvro.app-policy.v1` (installation-scoped, non-sensitive, NOT wiped on sign-out). */
const CachedPolicySchema = z.object({
  v: z.literal(1),
  savedAt: z.number().int().nonnegative(),
  snapshot: PolicySnapshotSchema.nullable(),
  softDismissedAt: z.number().int().nonnegative().nullable(),
});
export type CachedPolicy = z.infer<typeof CachedPolicySchema>;

/** Unreadable or foreign-shaped cache data counts as "no cached policy" (the server enforces on the next call). */
export function parseCachedPolicy(raw: string | null): CachedPolicy | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = CachedPolicySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
