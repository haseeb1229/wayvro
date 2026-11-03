/**
 * Pure app version policy evaluation (A01/Q31; ADR-049; UNIT-POLICY). Used by `GET /v1/app/config` and by the
 * enforcement hook, so the client state and the server's 426/503 decisions can never disagree.
 *
 * Precedence: HARD_UPDATE (build below the minimum, or inside a blocked range — the range's reason wins) >
 * MAINTENANCE > SOFT_UPDATE (minimum <= build < recommended) > OK. A build that must update is told so even during
 * maintenance (it cannot proceed afterwards either). Deliberate fail-open (ADR-049; checklist item 16): no client
 * headers or no ACTIVE policy for the platform means OK — an absent or empty policy must never brick installs.
 * The headers are compatibility hints only: lying about the build changes nothing but this evaluation.
 */
import type { AppPlatform, BlockedBuildRange } from '@wayvro/config';

type ClientPolicyState = 'OK' | 'SOFT_UPDATE' | 'HARD_UPDATE' | 'MAINTENANCE';
type HardUpdateReason = BlockedBuildRange['reasonCode'] | 'MINIMUM_BUILD';

/** The ACTIVE version policy of one platform (blocked ranges inclusive). */
export interface ActiveAppPolicy {
  readonly id: string;
  readonly platform: AppPlatform;
  readonly version: number;
  readonly minSupportedBuild: number;
  readonly recommendedBuild: number;
  readonly storeUrlKey: string | null;
  readonly softMessageKey: string;
  readonly hardMessageKey: string;
  readonly blockedRanges: readonly BlockedBuildRange[];
}

/** The calling installed app, from `x-wayvro-platform` + `x-wayvro-app-build` (both present and well-formed). */
export interface AppClient {
  readonly platform: AppPlatform;
  readonly build: number;
}

export interface MaintenanceView {
  readonly active: boolean;
  readonly messageKey: string | null;
  readonly expectedEnd: Date | null;
}

export interface ClientPolicy {
  readonly state: ClientPolicyState;
  readonly reasonClass: HardUpdateReason | null;
  readonly messageKey: string | null;
  readonly storeUrlKey: string | null;
  readonly recommendedBuild: number | null;
  readonly minSupportedBuild: number | null;
}

export interface PolicyInput {
  readonly client: AppClient | null;
  /** The ACTIVE policy of the client's platform (callers select by platform), or null when none is ACTIVE. */
  readonly policy: ActiveAppPolicy | null;
  readonly maintenance: MaintenanceView;
}

export function evaluateAppPolicy({ client, policy, maintenance }: PolicyInput): ClientPolicy {
  const applicable = client !== null && policy !== null && policy.platform === client.platform ? policy : null;
  const builds = { recommendedBuild: applicable?.recommendedBuild ?? null, minSupportedBuild: applicable?.minSupportedBuild ?? null };
  if (client !== null && applicable !== null) {
    const blocked = applicable.blockedRanges.find((r) => r.fromBuild <= client.build && client.build <= r.toBuild);
    const reasonClass: HardUpdateReason | null = blocked ? blocked.reasonCode : client.build < applicable.minSupportedBuild ? 'MINIMUM_BUILD' : null;
    if (reasonClass !== null) {
      return { state: 'HARD_UPDATE', reasonClass, messageKey: applicable.hardMessageKey, storeUrlKey: applicable.storeUrlKey, ...builds };
    }
  }
  if (maintenance.active) return { state: 'MAINTENANCE', reasonClass: null, messageKey: maintenance.messageKey, storeUrlKey: null, ...builds };
  if (client !== null && applicable !== null && client.build < applicable.recommendedBuild) {
    return { state: 'SOFT_UPDATE', reasonClass: null, messageKey: applicable.softMessageKey, storeUrlKey: applicable.storeUrlKey, ...builds };
  }
  return { state: 'OK', reasonClass: null, messageKey: null, storeUrlKey: applicable?.storeUrlKey ?? null, ...builds };
}

/** Seconds until the expected end of maintenance (at least 1), or undefined when no future end is known. */
export function maintenanceRetryAfterSeconds(maintenance: MaintenanceView, nowMs: number): number | undefined {
  if (!maintenance.active || maintenance.expectedEnd === null) return undefined;
  const seconds = Math.ceil((maintenance.expectedEnd.getTime() - nowMs) / 1000);
  return seconds > 0 ? seconds : undefined;
}
