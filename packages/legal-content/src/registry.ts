/** Published-document registry over the catalogue: hashing, immutability lock, current-version and change-log lookups. */
import { createHash } from 'node:crypto';
import { POLICY_CATALOGUE } from './catalogue.js';
import { PUBLISHED_CONTENT_HASHES } from './published-hashes.js';
import { POLICY_LOCALES, type PolicyBody, type PolicyDefinition, type PolicyKey, type PolicyLocale, type PublishedPolicyDocument } from './types.js';

/** Canonical serialisation of a body (fixed field order) → lower-case hex SHA-256. */
export function contentSha256(body: PolicyBody): string {
  const canonical = JSON.stringify([body.title, body.sections.map((s) => [s.heading, s.paragraphs])]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export class PolicyCatalogueError extends Error {
  override readonly name = 'PolicyCatalogueError';
}

/** @internal returned by buildRegistry (tests). */
export interface PolicyRegistry {
  readonly documents: readonly PublishedPolicyDocument[];
  document(key: PolicyKey, version: number, locale: PolicyLocale): PublishedPolicyDocument | undefined;
  current(key: PolicyKey, locale: PolicyLocale, now: Date): PublishedPolicyDocument | undefined;
  changeLog(locale: PolicyLocale): readonly PublishedPolicyDocument[];
  keyForSlug(slug: string): PolicyKey | undefined;
}

/**
 * Publishes a catalogue against a hash lock. Published texts are immutable: an in-place edit changes the hash and is
 * refused here.
 * @internal exported for the registry tests (production uses the module-level registry below).
 */
export function buildRegistry(catalogue: readonly PolicyDefinition[], lock: Readonly<Record<string, string>>): PolicyRegistry {
  const documents: PublishedPolicyDocument[] = [];
  for (const policy of catalogue) {
    for (const v of policy.versions) {
      for (const locale of POLICY_LOCALES) {
        const body = v.body[locale];
        const sha = contentSha256(body);
        const id = `${policy.key}@${String(v.version)}:${locale}`;
        if (lock[id] !== sha) throw new PolicyCatalogueError(`${id}: content hash is not the published one (edit = new version)`);
        documents.push({
          key: policy.key,
          slug: policy.slug,
          version: v.version,
          locale,
          status: v.status,
          effectiveAt: v.effectiveAt,
          materialChange: v.materialChange,
          approvalRef: v.approvalRef,
          requiredFor: policy.requiredFor,
          changeSummary: v.changeSummary[locale],
          body,
          contentSha256: sha,
          canonicalPath: `/legal/${policy.slug}/v${String(v.version)}`,
        });
      }
    }
  }
  Object.freeze(documents);
  return {
    documents,
    document: (key, version, locale) => documents.find((d) => d.key === key && d.version === version && d.locale === locale),
    current(key, locale, now) {
      let best: PublishedPolicyDocument | undefined;
      for (const d of documents) {
        if (d.key !== key || d.locale !== locale || Date.parse(d.effectiveAt) > now.getTime()) continue;
        if (!best || d.version > best.version) best = d;
      }
      return best;
    },
    changeLog: (locale) =>
      documents
        .filter((d) => d.locale === locale)
        .toSorted((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt) || a.key.localeCompare(b.key) || b.version - a.version),
    keyForSlug: (slug) => catalogue.find((p) => p.slug === slug)?.key,
  };
}

const REGISTRY = buildRegistry(POLICY_CATALOGUE, PUBLISHED_CONTENT_HASHES);

/** Every published (key, version, locale) document. */
export const publishedDocuments = (): readonly PublishedPolicyDocument[] => REGISTRY.documents;
/** One exact document, or undefined. */
export const policyDocument = (key: PolicyKey, version: number, locale: PolicyLocale): PublishedPolicyDocument | undefined =>
  REGISTRY.document(key, version, locale);
/** The current version of a policy at `now` (latest effectiveAt <= now), or undefined if none is effective yet. */
export const currentDocument = (key: PolicyKey, locale: PolicyLocale, now: Date): PublishedPolicyDocument | undefined => REGISTRY.current(key, locale, now);
/** Every version of every policy in a locale, newest first (the public change log, W05/R09). */
export const changeLog = (locale: PolicyLocale): readonly PublishedPolicyDocument[] => REGISTRY.changeLog(locale);
/** Slug → key (public URLs). */
export const policyKeyForSlug = (slug: string): PolicyKey | undefined => REGISTRY.keyForSlug(slug);
