/**
 * App version policy guardrails (Phase 3 P3.4; T3-25 "bricking users"; ADR-049). Pure rules shared by the API (draft,
 * submit, approve, manual activation) and the worker's scheduled activation, which re-checks them at run time.
 *
 * Released-build source: no store build exists yet, so the latest RELEASED build per platform is validated
 * configuration (`APP_LATEST_RELEASED_BUILD_ANDROID` / `APP_LATEST_RELEASED_BUILD_IOS`, default 0 = nothing released).
 * A release-process registry replaces it at Phase 7 (ADR-049). The same rule applies in every environment: with
 * nothing released, no policy may set a minimum build above 0, so an empty or mistaken configuration can never brick
 * an install.
 */
import { z } from 'zod';
import { isNonProductionLike, type WayvroEnv } from './env.js';

export const APP_PLATFORMS = ['ANDROID', 'IOS'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** Why a build range is blocked (shown to the user as a reason class on the HARD_UPDATE screen). */
export const BLOCKED_BUILD_REASONS = ['SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK'] as const;
export type BlockedBuildReason = (typeof BLOCKED_BUILD_REASONS)[number];

/** Upper bound of a native build number (the `x-wayvro-app-build` header accepts at most 9 digits). */
export const MAX_APP_BUILD = 999_999_999;

const releasedBuild = z.coerce.number().int().min(0).max(MAX_APP_BUILD).default(0);
export const releaseEnvSchema = z.object({
  APP_LATEST_RELEASED_BUILD_ANDROID: releasedBuild,
  APP_LATEST_RELEASED_BUILD_IOS: releasedBuild,
});

export type ReleasedBuilds = Readonly<Record<AppPlatform, number>>;

export function releasedBuildsOf(config: {
  readonly APP_LATEST_RELEASED_BUILD_ANDROID: number;
  readonly APP_LATEST_RELEASED_BUILD_IOS: number;
}): ReleasedBuilds {
  return { ANDROID: config.APP_LATEST_RELEASED_BUILD_ANDROID, IOS: config.APP_LATEST_RELEASED_BUILD_IOS };
}

/** An inclusive build range (`fromBuild`..`toBuild`). */
export interface BlockedBuildRange {
  readonly fromBuild: number;
  readonly toBuild: number;
  readonly reasonCode: BlockedBuildReason;
}

export interface PolicyGuardrailInput {
  readonly platform: AppPlatform;
  readonly minSupportedBuild: number;
  readonly recommendedBuild: number;
  readonly storeUrlKey: string | null;
  readonly blockedRanges: readonly BlockedBuildRange[];
}

const GUARDRAIL_PROBLEMS = [
  'RECOMMENDED_BELOW_MINIMUM',
  'MINIMUM_ABOVE_LATEST_RELEASED',
  'BLOCKED_RANGE_INVALID',
  'BLOCKED_RANGES_OVERLAP',
  'BLOCKED_RANGE_COVERS_LATEST_RELEASED',
  'HARD_UPDATE_NEEDS_STORE_URL',
] as const;
export type GuardrailProblem = (typeof GUARDRAIL_PROBLEMS)[number];

/**
 * Every guardrail the candidate policy violates (empty = may be submitted/approved/activated):
 *  - `recommended_build >= min_supported_build`;
 *  - `min_supported_build <= latest released build` of the platform;
 *  - blocked ranges are well-formed (`0 <= from <= to <= MAX_APP_BUILD`), do not overlap and never cover the latest
 *    released build;
 *  - staging/production: a policy that can produce HARD_UPDATE (minimum above 0 or any blocked range) needs a store URL
 *    key, so the update screen can always point somewhere.
 */
export function appPolicyGuardrailProblems(input: PolicyGuardrailInput, released: ReleasedBuilds, env: WayvroEnv): GuardrailProblem[] {
  const problems = new Set<GuardrailProblem>();
  const latest = released[input.platform];
  if (input.recommendedBuild < input.minSupportedBuild) problems.add('RECOMMENDED_BELOW_MINIMUM');
  if (input.minSupportedBuild > latest) problems.add('MINIMUM_ABOVE_LATEST_RELEASED');
  const ranges = [...input.blockedRanges].sort((a, b) => a.fromBuild - b.fromBuild);
  ranges.forEach((r, i) => {
    if (!Number.isInteger(r.fromBuild) || !Number.isInteger(r.toBuild) || r.fromBuild < 0 || r.toBuild < r.fromBuild || r.toBuild > MAX_APP_BUILD) {
      problems.add('BLOCKED_RANGE_INVALID');
    }
    const next = ranges[i + 1];
    if (next && next.fromBuild <= r.toBuild) problems.add('BLOCKED_RANGES_OVERLAP');
    if (r.fromBuild <= latest && latest <= r.toBuild) problems.add('BLOCKED_RANGE_COVERS_LATEST_RELEASED');
  });
  const canHardUpdate = input.minSupportedBuild > 0 || input.blockedRanges.length > 0;
  if (!isNonProductionLike(env) && canHardUpdate && input.storeUrlKey === null) problems.add('HARD_UPDATE_NEEDS_STORE_URL');
  return GUARDRAIL_PROBLEMS.filter((p) => problems.has(p));
}

/**
 * The transaction-scoped advisory-lock key serialising every activation of one platform's version policy (manual
 * activation in the API and scheduled activation in the worker take the same lock, then compare-and-set the status).
 */
export function appPolicyActivationLockKey(platform: AppPlatform): string {
  return `wayvro.activation:app-policy:${platform}`;
}

/**
 * The advisory-lock key serialising every activation of one (city, product)'s rate cards (P3.3): the staff activation
 * in the API and the scheduled activation in the worker take the same lock, then compare-and-set `status = 'APPROVED'`.
 */
export function rateCardActivationLockKey(cityCode: string, productCode: string): string {
  return `wayvro.activation:rate-card:${cityCode}:${productCode}`;
}
