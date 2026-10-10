/** Policy keys (R09: separate documents; W05: canonical public pages). Never renamed — consent rows reference them. */
export const POLICY_KEYS = [
  'TERMS',
  'PRIVACY',
  'DRIVER_PARTNER_AGREEMENT',
  'BIOMETRIC_KYC_NOTICE',
  'COMMUNITY_GUIDELINES',
  'CANCELLATION_REFUND',
  'AGE_ELIGIBILITY',
] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];

/** Locales in which policy documents are published (Roman-Urdu readers are served English until counsel decides). */
export const POLICY_LOCALES = ['en', 'ur'] as const;
export type PolicyLocale = (typeof POLICY_LOCALES)[number];

/**
 * `PLACEHOLDER_NOT_FOR_PRODUCTION` texts are structural outlines written without counsel; production refuses them
 * (CL-P2-09). `APPROVED` requires an approval reference to counsel's sign-off (EG-02/EG-15).
 */
export const POLICY_STATUSES = ['PLACEHOLDER_NOT_FOR_PRODUCTION', 'APPROVED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** When acceptance of the current version is required. */
export const POLICY_REQUIREMENTS = ['ACCOUNT', 'DRIVER_APPLICATION'] as const;
export type PolicyRequirement = (typeof POLICY_REQUIREMENTS)[number];

export interface PolicySection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/** Structured document body (rendered by web-public and the app; no markup language, so no renderer dependency). */
export interface PolicyBody {
  readonly title: string;
  readonly sections: readonly PolicySection[];
}

interface PolicyVersionDefinition {
  readonly version: number;
  readonly status: PolicyStatus;
  /** ISO-8601 UTC; the version becomes current at this server time. */
  readonly effectiveAt: string;
  /** A material change requires re-acceptance; a non-material change is communicated only. */
  readonly materialChange: boolean;
  readonly approvalRef: string | null;
  readonly changeSummary: Readonly<Record<PolicyLocale, string>>;
  readonly body: Readonly<Record<PolicyLocale, PolicyBody>>;
}

export interface PolicyDefinition {
  readonly key: PolicyKey;
  /** URL slug of the canonical public page (`/legal/<slug>` and `/legal/<slug>/v<version>`). */
  readonly slug: string;
  readonly requiredFor: readonly PolicyRequirement[];
  readonly versions: readonly PolicyVersionDefinition[];
}

/** One immutable (key, version, locale) document as published to the registry and the public web. */
export interface PublishedPolicyDocument {
  readonly key: PolicyKey;
  readonly slug: string;
  readonly version: number;
  readonly locale: PolicyLocale;
  readonly status: PolicyStatus;
  readonly effectiveAt: string;
  readonly materialChange: boolean;
  readonly approvalRef: string | null;
  readonly requiredFor: readonly PolicyRequirement[];
  readonly changeSummary: string;
  readonly body: PolicyBody;
  /** Lower-case hex SHA-256 of the canonical serialisation of `body` (what a consent record binds to). */
  readonly contentSha256: string;
  readonly canonicalPath: string;
}
