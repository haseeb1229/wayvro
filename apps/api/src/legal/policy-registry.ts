/**
 * Policy registry (A04/R09/W05, ADR-044). The texts live in @wayvro/legal-content; at boot the API registers every
 * published (key, version, locale) into the immutable `legal.policy_documents` table (insert-only; a trigger forbids
 * changes) and verifies that every registered row equals the catalogue. A mismatch means a published text was edited
 * in place — boot is refused. Consent records reference (key, version, locale, content hash) by foreign key, so the
 * database itself binds every consent to the exact text.
 *
 * Production refuses placeholder texts and a placeholder age policy (CL-P2-09, EG-02/EG-23).
 */
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { POLICY_KEYS, POLICY_LOCALES, currentDocument, publishedDocuments, type PublishedPolicyDocument } from '@wayvro/legal-content';
import type { Logger } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';
import { currentAgePolicy } from './age-policy.js';

/** @internal exported for the registry tests. */
export class PolicyRegistryError extends Error {
  override readonly name = 'PolicyRegistryError';
}

interface RegisteredRow {
  policy_key: string;
  version: number;
  locale: string;
  content_sha256: Buffer;
  status: string;
  material_change: boolean;
  effective_at: Date;
  canonical_path: string;
  approval_ref: string | null;
}

const idOf = (key: string, version: number, locale: string): string => `${key}@${String(version)}:${locale}`;

/**
 * Registers the catalogue and verifies the registry; throws PolicyRegistryError on any drift.
 * @internal exported for the registry tests (production calls preparePolicyRegistry).
 */
export async function registerPolicyCatalogue(q: Queryable, log: Logger, documents: readonly PublishedPolicyDocument[] = publishedDocuments()): Promise<void> {
  for (const d of documents) {
    await q.query(
      `insert into legal.policy_documents (policy_key, version, locale, content_sha256, status, material_change, effective_at, canonical_path, approval_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (policy_key, version, locale) do nothing`,
      [d.key, d.version, d.locale, Buffer.from(d.contentSha256, 'hex'), d.status, d.materialChange, d.effectiveAt, d.canonicalPath, d.approvalRef],
    );
  }
  const rows = await q.query<RegisteredRow>(`select * from legal.policy_documents`);
  const expected = new Map(documents.map((d) => [idOf(d.key, d.version, d.locale), d]));
  for (const row of rows.rows) {
    const id = idOf(row.policy_key, row.version, row.locale);
    const d = expected.get(id);
    if (!d) {
      // Registered by a newer build (e.g. during a rollback): kept, never rewritten; this build does not serve it.
      log.warn({ policy: id }, 'policy registry holds a version unknown to this build');
      continue;
    }
    const same =
      row.content_sha256.toString('hex') === d.contentSha256 &&
      row.status === d.status &&
      row.material_change === d.materialChange &&
      row.effective_at.getTime() === Date.parse(d.effectiveAt) &&
      row.canonical_path === d.canonicalPath &&
      row.approval_ref === d.approvalRef;
    if (!same)
      throw new PolicyRegistryError(`${id}: registered policy differs from the published catalogue (published texts are immutable; publish a new version)`);
  }
}

/**
 * Problems that make an environment unfit to serve real users: production must not serve placeholder policy texts or a
 * placeholder age policy. Empty in local/test/staging (staging may run placeholders, docs/phase2 CL-P2-09).
 * @internal exported for the BOOT-NEG unit test.
 */
export function productionPolicyProblems(env: WayvroEnv, agePolicyStatus: string, now: Date): string[] {
  if (isNonProductionLike(env) || env === 'staging') return [];
  const problems: string[] = [];
  for (const key of POLICY_KEYS) {
    for (const locale of POLICY_LOCALES) {
      const d = currentDocument(key, locale, now);
      if (!d) problems.push(`${key}/${locale}: no effective version`);
      else if (d.status !== 'APPROVED') problems.push(`${key}@${String(d.version)}/${locale}: placeholder text is not counsel-approved (EG-02)`);
    }
  }
  if (agePolicyStatus !== 'APPROVED') problems.push('age-eligibility policy: placeholder is not counsel-approved (EG-23)');
  return problems;
}

/** Boot step: register + verify, then refuse production with placeholders. */
export async function preparePolicyRegistry(q: Queryable, env: WayvroEnv, log: Logger): Promise<void> {
  await registerPolicyCatalogue(q, log);
  const age = await currentAgePolicy(q);
  const problems = productionPolicyProblems(env, age.status, new Date());
  if (problems.length > 0) throw new PolicyRegistryError(`WAYVRO_ENV=${env} refuses to serve:\n - ${problems.join('\n - ')}`);
}
