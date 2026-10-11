import type { PolicyDocument, PolicyKey, PolicyList } from '@wayvro/contracts';
import { PolicyKeySchema } from '@wayvro/contracts';

/**
 * Legal list and policy text (W05 in-app counterpart). Placeholder texts are always labelled
 * (`PLACEHOLDER_NOT_FOR_PRODUCTION`). Driver-application documents are not listed in the rider account slice.
 */

export interface LegalListItem {
  readonly policyKey: PolicyKey;
  readonly version: number;
  readonly title: string;
  readonly effectiveAt: string;
  readonly placeholder: boolean;
}

export function legalListModel(list: PolicyList): readonly LegalListItem[] {
  return list.policies
    .filter((p) => p.requiredFor.length === 0 || p.requiredFor.includes('ACCOUNT'))
    .map((p) => ({
      policyKey: p.policyKey,
      version: p.version,
      title: p.title,
      effectiveAt: p.effectiveAt,
      placeholder: p.status === 'PLACEHOLDER_NOT_FOR_PRODUCTION',
    }));
}

export interface PolicyDocumentModel {
  readonly title: string;
  readonly version: number;
  readonly effectiveAt: string;
  readonly placeholder: boolean;
  readonly shownInEnglish: boolean;
  readonly sections: PolicyDocument['body']['sections'];
}

export function policyDocumentModel(doc: PolicyDocument, uiIsEnglish: boolean): PolicyDocumentModel {
  return {
    title: doc.body.title.trim() === '' ? doc.title : doc.body.title,
    version: doc.version,
    effectiveAt: doc.effectiveAt,
    placeholder: doc.status === 'PLACEHOLDER_NOT_FOR_PRODUCTION',
    shownInEnglish: !uiIsEnglish && doc.locale === 'en',
    sections: doc.body.sections,
  };
}

export type PolicyRouteParams =
  { readonly ok: true; readonly policyKey: PolicyKey; readonly version: number; readonly locale: 'en' | 'ur' } | { readonly ok: false };

/** Validates route params (deep links are untrusted input). */
export function parsePolicyRouteParams(raw: { policyKey?: unknown; version?: unknown; locale?: unknown }, fallbackLocale: 'en' | 'ur'): PolicyRouteParams {
  const key = PolicyKeySchema.safeParse(raw.policyKey);
  const version = typeof raw.version === 'string' && /^[1-9][0-9]{0,5}$/.test(raw.version) ? Number(raw.version) : null;
  if (!key.success || version === null) return { ok: false };
  const locale = raw.locale === 'en' || raw.locale === 'ur' ? raw.locale : fallbackLocale;
  return { ok: true, policyKey: key.data, version, locale };
}
