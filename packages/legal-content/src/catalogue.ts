/**
 * The policy catalogue: every published version of every policy. A published version is IMMUTABLE — a change of
 * wording is a new version (material or not). `PUBLISHED_CONTENT_HASHES` locks the hash of every published
 * (key, version, locale); the unit test fails if a published text is edited in place, and the API refuses to boot if
 * the registry table disagrees with this catalogue.
 */
import { PLACEHOLDER_CHANGE_SUMMARY, placeholderBody } from './placeholders.js';
import type { PolicyDefinition, PolicyKey, PolicyRequirement } from './types.js';

const FIRST_PLACEHOLDER_EFFECTIVE_AT = '2026-10-10T00:00:00.000Z';

const SLUGS: Readonly<Record<PolicyKey, string>> = {
  TERMS: 'terms',
  PRIVACY: 'privacy',
  DRIVER_PARTNER_AGREEMENT: 'driver-partner-agreement',
  BIOMETRIC_KYC_NOTICE: 'identity-verification-notice',
  COMMUNITY_GUIDELINES: 'community-guidelines',
  CANCELLATION_REFUND: 'cancellation-and-refunds',
  AGE_ELIGIBILITY: 'age-eligibility',
};

/**
 * Acceptance requirements (data model §7): TERMS + PRIVACY for account use; DRIVER_PARTNER_AGREEMENT +
 * BIOMETRIC_KYC_NOTICE before a driver application leaves DRAFT (K14). COMMUNITY_GUIDELINES becomes required once its
 * approved text exists (N02); the others are disclosures.
 */
const REQUIRED_FOR: Readonly<Record<PolicyKey, readonly PolicyRequirement[]>> = {
  TERMS: ['ACCOUNT'],
  PRIVACY: ['ACCOUNT'],
  DRIVER_PARTNER_AGREEMENT: ['DRIVER_APPLICATION'],
  BIOMETRIC_KYC_NOTICE: ['DRIVER_APPLICATION'],
  COMMUNITY_GUIDELINES: [],
  CANCELLATION_REFUND: [],
  AGE_ELIGIBILITY: [],
};

function firstPlaceholder(key: PolicyKey): PolicyDefinition {
  return {
    key,
    slug: SLUGS[key],
    requiredFor: REQUIRED_FOR[key],
    versions: [
      {
        version: 1,
        status: 'PLACEHOLDER_NOT_FOR_PRODUCTION',
        effectiveAt: FIRST_PLACEHOLDER_EFFECTIVE_AT,
        materialChange: true,
        approvalRef: null,
        changeSummary: PLACEHOLDER_CHANGE_SUMMARY,
        body: { en: placeholderBody(key, 'en'), ur: placeholderBody(key, 'ur') },
      },
    ],
  };
}

export const POLICY_CATALOGUE: readonly PolicyDefinition[] = [
  firstPlaceholder('TERMS'),
  firstPlaceholder('PRIVACY'),
  firstPlaceholder('DRIVER_PARTNER_AGREEMENT'),
  firstPlaceholder('BIOMETRIC_KYC_NOTICE'),
  firstPlaceholder('COMMUNITY_GUIDELINES'),
  firstPlaceholder('CANCELLATION_REFUND'),
  firstPlaceholder('AGE_ELIGIBILITY'),
];
