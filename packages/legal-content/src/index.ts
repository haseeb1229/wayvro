/**
 * Policy content (ADR-044): one source for web-public's canonical pages and the API's policy registry. Pure data plus
 * SHA-256 hashing; no I/O, no environment access.
 */
export {
  POLICY_KEYS,
  POLICY_LOCALES,
  POLICY_REQUIREMENTS,
  POLICY_STATUSES,
  type PolicyBody,
  type PolicyKey,
  type PolicyLocale,
  type PolicyRequirement,
  type PolicySection,
  type PolicyStatus,
  type PublishedPolicyDocument,
} from './types.js';
export { PolicyCatalogueError, changeLog, contentSha256, currentDocument, policyDocument, policyKeyForSlug, publishedDocuments } from './registry.js';
