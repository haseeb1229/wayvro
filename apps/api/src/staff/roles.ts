/**
 * Code-defined staff roles and permissions (H01; docs/phase2/PHASE2_STAFF_AUTHORIZATION_MATRIX.md §3–§4). Reviewed via
 * PR; the database stores only role ASSIGNMENTS (+ city scope). No runtime role or permission creation exists.
 * Permissions of later micro-phases are added here additively together with their routes.
 */
/** @internal exported for the authorisation-matrix tests */
export const STAFF_ROLES = [
  'KYC_REVIEWER',
  'KYC_SENIOR_REVIEWER',
  'COMPLIANCE_ADMIN',
  'TRUST_SAFETY_AGENT',
  'SUPPORT_AGENT',
  'STAFF_ADMIN',
  'AUDITOR',
  // Phase 3 (FA-10, approved 2026-10-12): dedicated least-privilege configuration roles. Maker-checker on every change
  // they make is a property of the route and the table (maker and checker may both hold the role but must be two
  // distinct staff identities); none of them holds break-glass, staff administration or KYC permissions.
  'PRICING_MANAGER',
  'CATALOG_MANAGER',
  'RELEASE_MANAGER',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffPermission =
  // staff administration
  | 'staff.invite'
  | 'staff.view_roster'
  | 'staff.role.grant'
  | 'staff.role.approve'
  | 'staff.role.revoke'
  | 'staff.offboard'
  | 'staff.reenrolment.issue'
  | 'staff.reenrolment.approve'
  // audit
  | 'audit.events.view'
  | 'audit.seals.verify'
  // break-glass
  | 'breakglass.activate'
  | 'breakglass.review'
  // restrictions (P2.5; V13)
  | 'restriction.view'
  | 'restriction.create'
  | 'restriction.create_account'
  | 'restriction.lift'
  // requirement sets and age-policy data (P2.5; K06/A15)
  | 'compliance.requirement_set.view'
  | 'compliance.requirement_set.draft'
  | 'compliance.requirement_set.approve'
  | 'legal.age_policy.draft'
  | 'legal.age_policy.approve'
  // evidence vault (P2.6): one-time evidence views with a recorded reason (case-claim scoping arrives with review cases, P2.7)
  | 'vault.evidence.view'
  // manual review, appeals and monitoring (P2.7)
  | 'kyc.queue.view'
  | 'kyc.case.claim'
  | 'kyc.case.view_masked'
  | 'kyc.decision.needs_info'
  | 'kyc.decision.reject'
  | 'kyc.decision.approve'
  | 'kyc.decision.require_in_person'
  | 'kyc.decision.second_approve'
  | 'appeal.view'
  | 'appeal.decide'
  | 'compliance.expiry_roster.view'
  | 'audit.evidence_access.view'
  // support capabilities (Phase-2 closure; staff matrix §4): masked summary, on-behalf session revocation, recovery
  // assistance (opens/attaches a human review, never decides it)
  | 'account.summary.view_masked'
  | 'account.sessions.revoke_on_behalf'
  | 'account.recovery_case.open'
  // Phase 3 catalog: service products, zone sets, eligibility rules (P3.1; E08/H10/R28)
  | 'catalog.view'
  | 'catalog.zone_set.draft'
  | 'catalog.zone_set.approve'
  | 'catalog.zone_set.activate'
  | 'catalog.eligibility_rule.draft'
  | 'catalog.eligibility_rule.approve'
  | 'catalog.eligibility_rule.activate'
  | 'catalog.product.enable_request'
  | 'catalog.product.enable_approve'
  | 'catalog.product.suspend'
  // Phase 3 geo cost controls and curated landmark aliases (P3.2; I11/A06)
  | 'geo.usage.view'
  | 'geo.budget.draft'
  | 'geo.budget.approve'
  | 'geo.alias.draft'
  | 'geo.alias.approve'
  // Phase 3 pricing: tax policies, rate cards, previews, support quote lookup (P3.3; H06/E05/B06)
  | 'pricing.view'
  | 'pricing.tax_policy.draft'
  | 'pricing.tax_policy.approve'
  | 'pricing.rate_card.draft'
  | 'pricing.rate_card.submit'
  | 'pricing.rate_card.approve'
  | 'pricing.rate_card.activate'
  | 'pricing.rate_card.rollback'
  | 'pricing.preview'
  | 'pricing.quote.view'
  // Phase 3 release controls: app version policies, maintenance, runtime switches (P3.4; A01/Q31/V10)
  | 'release.view'
  | 'release.policy.draft'
  | 'release.policy.approve'
  | 'release.policy.activate'
  | 'platform.switch.disable'
  | 'platform.switch.enable_request'
  | 'platform.switch.enable_approve';

/** Role → permissions (the ✓ cells of the matrix). Step-up and maker-checker are attributes of the ROUTE. @internal */
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly StaffPermission[]>> = {
  KYC_REVIEWER: [
    'breakglass.activate',
    'vault.evidence.view',
    'kyc.queue.view',
    'kyc.case.claim',
    'kyc.case.view_masked',
    'kyc.decision.needs_info',
    'kyc.decision.reject',
    'kyc.decision.approve',
    'kyc.decision.require_in_person',
    'compliance.expiry_roster.view',
  ],
  KYC_SENIOR_REVIEWER: [
    'breakglass.activate',
    'restriction.view',
    'restriction.create',
    'restriction.lift',
    'vault.evidence.view',
    'kyc.queue.view',
    'kyc.case.claim',
    'kyc.case.view_masked',
    'kyc.decision.needs_info',
    'kyc.decision.reject',
    'kyc.decision.approve',
    'kyc.decision.require_in_person',
    'compliance.expiry_roster.view',
    'kyc.decision.second_approve',
    'appeal.view',
    'appeal.decide',
  ],
  COMPLIANCE_ADMIN: [
    'breakglass.activate',
    'compliance.requirement_set.view',
    'compliance.requirement_set.draft',
    'compliance.requirement_set.approve',
    'legal.age_policy.draft',
    'legal.age_policy.approve',
    'compliance.expiry_roster.view',
  ],
  TRUST_SAFETY_AGENT: [
    'account.summary.view_masked',
    'account.sessions.revoke_on_behalf',
    'account.recovery_case.open',
    'breakglass.activate',
    'restriction.view',
    'restriction.create',
    'restriction.create_account',
    'restriction.lift',
    'vault.evidence.view',
    'appeal.view',
    'appeal.decide',
    'compliance.expiry_roster.view',
  ],
  SUPPORT_AGENT: ['account.summary.view_masked', 'account.sessions.revoke_on_behalf', 'account.recovery_case.open'],
  STAFF_ADMIN: [
    'staff.invite',
    'staff.view_roster',
    'staff.role.grant',
    'staff.role.approve',
    'staff.role.revoke',
    'staff.offboard',
    'staff.reenrolment.issue',
    'staff.reenrolment.approve',
    'breakglass.activate',
    'breakglass.review',
  ],
  AUDITOR: [
    'audit.events.view',
    'audit.seals.verify',
    'breakglass.review',
    'audit.evidence_access.view',
    // Phase 3: read-only configuration history (no drafts, approvals or quote lookups)
    'catalog.view',
    'geo.usage.view',
    'pricing.view',
    'release.view',
  ],
  // Pricing maker-checker (FA-10; authorisation §4): a second, DISTINCT PRICING_MANAGER approves; the database and the
  // service both refuse maker = checker. STAFF_ADMIN is not a pricing approver.
  PRICING_MANAGER: [
    'catalog.view',
    'pricing.view',
    'pricing.tax_policy.draft',
    'pricing.tax_policy.approve',
    'pricing.rate_card.draft',
    'pricing.rate_card.submit',
    'pricing.rate_card.approve',
    'pricing.rate_card.activate',
    'pricing.rate_card.rollback',
    'pricing.preview',
    'pricing.quote.view',
  ],
  CATALOG_MANAGER: [
    'catalog.view',
    'catalog.zone_set.draft',
    'catalog.zone_set.approve',
    'catalog.zone_set.activate',
    'catalog.eligibility_rule.draft',
    'catalog.eligibility_rule.approve',
    'catalog.eligibility_rule.activate',
    'catalog.product.enable_request',
    'catalog.product.enable_approve',
    'catalog.product.suspend',
    'geo.usage.view',
    'geo.budget.draft',
    'geo.budget.approve',
    'geo.alias.draft',
    'geo.alias.approve',
  ],
  RELEASE_MANAGER: [
    'release.view',
    'release.policy.draft',
    'release.policy.approve',
    'release.policy.activate',
    'platform.switch.disable',
    'platform.switch.enable_request',
    'platform.switch.enable_approve',
    'geo.usage.view',
  ],
};

/** Roles whose grant needs a second STAFF_ADMIN's approval (matrix §3); every other grant is active immediately. */
export const MAKER_CHECKER_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'KYC_REVIEWER',
  'KYC_SENIOR_REVIEWER',
  'COMPLIANCE_ADMIN',
  'TRUST_SAFETY_AGENT',
  'STAFF_ADMIN',
  'AUDITOR',
  'PRICING_MANAGER',
  'CATALOG_MANAGER',
  'RELEASE_MANAGER',
]);

/** Roles whose permissions are limited to the assignment's cities (ABAC `cityScope`). */
export const CITY_SCOPED_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>(['KYC_REVIEWER', 'KYC_SENIOR_REVIEWER', 'TRUST_SAFETY_AGENT', 'SUPPORT_AGENT']);

/** Reason classes a KYC senior reviewer may apply/lift (compliance reasons only, matrix §4); T&S has all staff classes. */
export const COMPLIANCE_REASON_CLASSES: ReadonlySet<string> = new Set(['COMPLIANCE', 'QUALITY']);

export function permissionsOf(roles: Iterable<StaffRole>): ReadonlySet<StaffPermission> {
  const out = new Set<StaffPermission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}
