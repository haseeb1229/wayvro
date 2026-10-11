/**
 * Server-side earning eligibility (data model §5; V13/D03/R02–R06/R46/A15). PURE and evaluated per request on server
 * time: documents are judged LIVE (an expired document blocks even if a stored projection says otherwise), every
 * applicable blocker is reported (ordered, exhaustive), and any blocker ⇒ not eligible. Lives in the API — never in a
 * client-importable package — so no client can hold an "authoritative" copy. Phase 4 adds trip/session blockers
 * (D26/D27) and calls it at go-online/accept/start.
 */
/** @internal exported for property tests */
export const RESTRICTION_SCOPES = ['ACCOUNT', 'DRIVER_ROLE', 'VEHICLE', 'SERVICE_CAPABILITY', 'CITY_CATEGORY'] as const;
export type RestrictionScope = (typeof RESTRICTION_SCOPES)[number];
/** @internal exported for property tests */
export const REASON_CLASSES = ['SAFETY', 'FRAUD', 'LEGAL', 'COMPLIANCE', 'QUALITY', 'SECURITY_HOLD', 'RISK_HOLD', 'AGE_POLICY'] as const;
export type ReasonClass = (typeof REASON_CLASSES)[number];

export interface RestrictionFact {
  readonly scope: RestrictionScope;
  readonly reasonClass: ReasonClass;
  readonly status: 'ACTIVE' | 'LIFT_PENDING_APPROVAL' | 'LIFTED' | 'EXPIRED';
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly driverProfileId: string | null;
  readonly vehicleId: string | null;
  readonly serviceCapabilityId: string | null;
  readonly cityCode: string | null;
  readonly serviceCategory: string | null;
}

/** A restriction is in force while ACTIVE (or awaiting a maker-checker lift) and inside its validity window. */
export function inForce(r: RestrictionFact, now: Date): boolean {
  return (r.status === 'ACTIVE' || r.status === 'LIFT_PENDING_APPROVAL') && r.effectiveFrom <= now && (r.effectiveUntil === null || r.effectiveUntil > now);
}

/** V13: only ACCOUNT-scope restrictions affect rider (passenger) use; driver-side scopes never do. */
export function blocksRiderUse(r: RestrictionFact, now: Date): boolean {
  return inForce(r, now) && r.scope === 'ACCOUNT';
}

export interface DocumentFact {
  readonly type: string;
  readonly status: 'SUBMITTED' | 'UNDER_REVIEW' | 'VALID' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  /** Reviewer-confirmed expiry (YYYY-MM-DD) or null for documents without expiry. */
  readonly expiresOn: string | null;
  readonly licenceClass: string | null;
  readonly vehicleId: string | null;
}

export interface RequirementItemFact {
  readonly type: string;
  readonly mandatory: boolean;
  readonly appliesToOwnershipTypes: readonly string[];
  readonly licenceClassesAllowed: readonly string[];
  readonly subject: 'DRIVER' | 'VEHICLE' | 'DRIVER_VEHICLE';
}

export interface EligibilityInput {
  readonly now: Date;
  readonly productionLike: boolean;
  readonly accountActive: boolean;
  readonly restrictions: readonly RestrictionFact[];
  readonly profile: { readonly id: string; readonly state: 'VERIFIED' | 'ACTIVE_ELIGIBLE' | 'EXPIRED' | 'REVERIFY_DUE' } | null;
  readonly vehicle: { readonly id: string; readonly ownershipType: string } | null;
  readonly cityCode: string;
  readonly serviceCategory: string;
  readonly serviceCategoryEnabled: boolean;
  readonly capability: { readonly id: string; readonly status: 'GRANTED' | 'REVOKED' } | null;
  readonly requirementSet: { readonly isPlaceholder: boolean; readonly items: readonly RequirementItemFact[] } | null;
  readonly documents: readonly DocumentFact[];
  readonly agePolicy: { readonly status: string; readonly driverMinimumAge: number | null };
  /** Reviewer-confirmed date of birth (YYYY-MM-DD) of the driver profile, if known. */
  readonly driverDateOfBirth: string | null;
}

type BlockerCode =
  | 'ACCOUNT_RESTRICTED'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'NO_DRIVER_PROFILE'
  | 'PROFILE_REVERIFICATION_DUE'
  | 'DRIVER_ROLE_RESTRICTED'
  | 'NO_VEHICLE'
  | 'VEHICLE_RESTRICTED'
  | 'SERVICE_CATEGORY_DISABLED_LEGAL_GATE'
  | 'CAPABILITY_NOT_GRANTED'
  | 'CAPABILITY_RESTRICTED'
  | 'CITY_CATEGORY_RESTRICTED'
  | 'NO_ACTIVE_REQUIREMENT_SET'
  | 'REQUIREMENT_SET_PLACEHOLDER'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_EXPIRED'
  | 'DOCUMENT_NOT_VALID'
  | 'LICENCE_CLASS_NOT_ALLOWED'
  | 'AGE_POLICY_PLACEHOLDER'
  | 'DRIVER_AGE_BELOW_MINIMUM';

interface Blocker {
  readonly code: BlockerCode;
  readonly documentType?: string;
}

export interface Eligibility {
  readonly eligible: boolean;
  readonly blockers: readonly Blocker[];
}

const today = (now: Date): string => now.toISOString().slice(0, 10);

/** Whole years between a YYYY-MM-DD date of birth and `now` (UTC calendar). @internal */
export function ageOn(dateOfBirth: string, now: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

export function evaluateEarningEligibility(input: EligibilityInput): Eligibility {
  const { now } = input;
  const blockers: Blocker[] = [];
  const active = input.restrictions.filter((r) => inForce(r, now));
  if (!input.accountActive) blockers.push({ code: 'ACCOUNT_NOT_ACTIVE' });
  if (active.some((r) => r.scope === 'ACCOUNT')) blockers.push({ code: 'ACCOUNT_RESTRICTED' });
  const profile = input.profile;
  if (!profile) blockers.push({ code: 'NO_DRIVER_PROFILE' });
  else {
    if (profile.state === 'REVERIFY_DUE') blockers.push({ code: 'PROFILE_REVERIFICATION_DUE' });
    if (active.some((r) => r.scope === 'DRIVER_ROLE' && r.driverProfileId === profile.id)) blockers.push({ code: 'DRIVER_ROLE_RESTRICTED' });
    if (
      active.some(
        (r) => r.scope === 'CITY_CATEGORY' && r.driverProfileId === profile.id && r.cityCode === input.cityCode && r.serviceCategory === input.serviceCategory,
      )
    ) {
      blockers.push({ code: 'CITY_CATEGORY_RESTRICTED' });
    }
  }
  if (!input.vehicle) blockers.push({ code: 'NO_VEHICLE' });
  else if (active.some((r) => r.scope === 'VEHICLE' && r.vehicleId === input.vehicle?.id)) blockers.push({ code: 'VEHICLE_RESTRICTED' });
  if (!input.serviceCategoryEnabled) blockers.push({ code: 'SERVICE_CATEGORY_DISABLED_LEGAL_GATE' });
  if (input.capability?.status !== 'GRANTED') blockers.push({ code: 'CAPABILITY_NOT_GRANTED' });
  else if (active.some((r) => r.scope === 'SERVICE_CAPABILITY' && r.serviceCapabilityId === input.capability?.id))
    blockers.push({ code: 'CAPABILITY_RESTRICTED' });

  const set = input.requirementSet;
  if (!set) blockers.push({ code: 'NO_ACTIVE_REQUIREMENT_SET' });
  else {
    if (set.isPlaceholder && input.productionLike) blockers.push({ code: 'REQUIREMENT_SET_PLACEHOLDER' });
    const ownership = input.vehicle?.ownershipType ?? null;
    for (const item of set.items) {
      if (!item.mandatory) continue;
      if (item.appliesToOwnershipTypes.length > 0 && (ownership === null || !item.appliesToOwnershipTypes.includes(ownership))) continue;
      const candidates = input.documents.filter(
        (d) => d.type === item.type && (item.subject === 'DRIVER' || (input.vehicle !== null && d.vehicleId === input.vehicle.id)),
      );
      const valid = candidates.filter((d) => d.status === 'VALID' && (d.expiresOn === null || d.expiresOn > today(now)));
      if (valid.length === 0) {
        const expired = candidates.some((d) => d.status === 'EXPIRED' || (d.status === 'VALID' && d.expiresOn !== null && d.expiresOn <= today(now)));
        blockers.push({ code: candidates.length === 0 ? 'DOCUMENT_MISSING' : expired ? 'DOCUMENT_EXPIRED' : 'DOCUMENT_NOT_VALID', documentType: item.type });
        continue;
      }
      if (item.licenceClassesAllowed.length > 0 && !valid.some((d) => d.licenceClass !== null && item.licenceClassesAllowed.includes(d.licenceClass))) {
        blockers.push({ code: 'LICENCE_CLASS_NOT_ALLOWED', documentType: item.type });
      }
    }
  }

  if (input.agePolicy.status !== 'APPROVED' && input.productionLike) blockers.push({ code: 'AGE_POLICY_PLACEHOLDER' });
  if (input.agePolicy.driverMinimumAge !== null && input.driverDateOfBirth !== null && ageOn(input.driverDateOfBirth, now) < input.agePolicy.driverMinimumAge) {
    blockers.push({ code: 'DRIVER_AGE_BELOW_MINIMUM' });
  }
  return { eligible: blockers.length === 0, blockers };
}
