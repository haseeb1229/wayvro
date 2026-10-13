import { describe, expect, it } from 'vitest';
import { appPolicyActivationLockKey, appPolicyGuardrailProblems, releaseEnvSchema, releasedBuildsOf, type PolicyGuardrailInput } from './release-guardrails.js';

const released = { ANDROID: 120, IOS: 0 } as const;
const base: PolicyGuardrailInput = { platform: 'ANDROID', minSupportedBuild: 100, recommendedBuild: 110, storeUrlKey: 'store.android', blockedRanges: [] };

describe('app version policy guardrails (T3-25)', () => {
  it('accepts a policy within every guardrail in every environment', () => {
    for (const env of ['local', 'test', 'staging', 'production'] as const) expect(appPolicyGuardrailProblems(base, released, env)).toEqual([]);
  });

  it('refuses a minimum above the latest released build, and any minimum above 0 when nothing is released', () => {
    expect(appPolicyGuardrailProblems({ ...base, minSupportedBuild: 121, recommendedBuild: 121 }, released, 'test')).toEqual(['MINIMUM_ABOVE_LATEST_RELEASED']);
    expect(appPolicyGuardrailProblems({ ...base, platform: 'IOS', minSupportedBuild: 1, recommendedBuild: 1 }, released, 'production')).toEqual([
      'MINIMUM_ABOVE_LATEST_RELEASED',
    ]);
    // nothing released: a soft-update-only policy (minimum 0) is still allowed
    expect(
      appPolicyGuardrailProblems({ ...base, platform: 'IOS', minSupportedBuild: 0, recommendedBuild: 5, storeUrlKey: null }, released, 'production'),
    ).toEqual([]);
  });

  it('refuses recommended below minimum', () => {
    expect(appPolicyGuardrailProblems({ ...base, recommendedBuild: 99 }, released, 'local')).toEqual(['RECOMMENDED_BELOW_MINIMUM']);
  });

  it('refuses malformed, overlapping or latest-covering blocked ranges', () => {
    const r = (fromBuild: number, toBuild: number) => ({ fromBuild, toBuild, reasonCode: 'SECURITY' as const });
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(10, 5)] }, released, 'test')).toEqual(['BLOCKED_RANGE_INVALID']);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(-1, 5)] }, released, 'test')).toEqual(['BLOCKED_RANGE_INVALID']);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(1.5, 5)] }, released, 'test')).toEqual(['BLOCKED_RANGE_INVALID']);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(1, 1_000_000_000)] }, released, 'test')).toEqual([
      'BLOCKED_RANGE_INVALID',
      'BLOCKED_RANGE_COVERS_LATEST_RELEASED',
    ]);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(20, 30), r(10, 20)] }, released, 'test')).toEqual(['BLOCKED_RANGES_OVERLAP']);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(10, 19), r(20, 30)] }, released, 'test')).toEqual([]);
    expect(appPolicyGuardrailProblems({ ...base, blockedRanges: [r(115, 120)] }, released, 'test')).toEqual(['BLOCKED_RANGE_COVERS_LATEST_RELEASED']);
  });

  it('staging/production: anything able to produce HARD_UPDATE needs a store URL key; local/test do not', () => {
    const noStore = { ...base, storeUrlKey: null };
    expect(appPolicyGuardrailProblems(noStore, released, 'staging')).toEqual(['HARD_UPDATE_NEEDS_STORE_URL']);
    expect(appPolicyGuardrailProblems(noStore, released, 'production')).toEqual(['HARD_UPDATE_NEEDS_STORE_URL']);
    expect(appPolicyGuardrailProblems(noStore, released, 'test')).toEqual([]);
    const blockedOnly = { ...noStore, minSupportedBuild: 0, blockedRanges: [{ fromBuild: 1, toBuild: 3, reasonCode: 'SECURITY' as const }] };
    expect(appPolicyGuardrailProblems(blockedOnly, released, 'production')).toEqual(['HARD_UPDATE_NEEDS_STORE_URL']);
    expect(appPolicyGuardrailProblems({ ...noStore, minSupportedBuild: 0 }, released, 'production')).toEqual([]);
  });

  it('released builds come from validated configuration (default 0 = nothing released)', () => {
    expect(releasedBuildsOf(releaseEnvSchema.parse({}))).toEqual({ ANDROID: 0, IOS: 0 });
    expect(releasedBuildsOf(releaseEnvSchema.parse({ APP_LATEST_RELEASED_BUILD_ANDROID: '42' }))).toEqual({ ANDROID: 42, IOS: 0 });
    expect(releaseEnvSchema.safeParse({ APP_LATEST_RELEASED_BUILD_IOS: '-1' }).success).toBe(false);
    expect(releaseEnvSchema.safeParse({ APP_LATEST_RELEASED_BUILD_IOS: '1000000000' }).success).toBe(false);
  });

  it('one activation lock key per platform', () => {
    expect(appPolicyActivationLockKey('ANDROID')).not.toBe(appPolicyActivationLockKey('IOS'));
  });
});
