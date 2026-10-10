/**
 * View-model adapter between @wayvro/legal-content and the legal pages (W05): picks the locale, resolves current or
 * exact versions on server time and shapes what the components render. Components hold no policy rules.
 */
import {
  POLICY_KEYS,
  changeLog,
  currentDocument,
  policyDocument,
  policyKeyForSlug,
  type PolicyLocale,
  type PublishedPolicyDocument,
} from '@wayvro/legal-content';

export type LegalLocale = PolicyLocale;

/** `?lang=ur` selects Urdu; anything else is English. */
export function localeFrom(lang: string | string[] | undefined): LegalLocale {
  return lang === 'ur' ? 'ur' : 'en';
}

export interface PolicyView {
  readonly slug: string;
  readonly title: string;
  readonly version: number;
  readonly locale: LegalLocale;
  readonly placeholder: boolean;
  readonly effectiveDate: string;
  readonly changeSummary: string;
  readonly contentSha256: string;
  readonly canonicalPath: string;
  readonly isCurrent: boolean;
  readonly sections: PublishedPolicyDocument['body']['sections'];
}

function toView(d: PublishedPolicyDocument, now: Date): PolicyView {
  return {
    slug: d.slug,
    title: d.body.title,
    version: d.version,
    locale: d.locale,
    placeholder: d.status !== 'APPROVED',
    effectiveDate: d.effectiveAt.slice(0, 10),
    changeSummary: d.changeSummary,
    contentSha256: d.contentSha256,
    canonicalPath: d.canonicalPath,
    isCurrent: currentDocument(d.key, d.locale, now)?.version === d.version,
    sections: d.body.sections,
  };
}

/** Current version of the policy behind a slug, or undefined (unknown slug / nothing effective yet). */
export function currentPolicyView(slug: string, locale: LegalLocale, now: Date): PolicyView | undefined {
  const key = policyKeyForSlug(slug);
  const d = key ? currentDocument(key, locale, now) : undefined;
  return d ? toView(d, now) : undefined;
}

/** An exact version (`v<N>` segment) that is already effective, or undefined. */
export function versionedPolicyView(slug: string, versionSegment: string, locale: LegalLocale, now: Date): PolicyView | undefined {
  const m = /^v([1-9][0-9]{0,5})$/.exec(versionSegment);
  const key = policyKeyForSlug(slug);
  if (!m?.[1] || !key) return undefined;
  const d = policyDocument(key, Number(m[1]), locale);
  return d && Date.parse(d.effectiveAt) <= now.getTime() ? toView(d, now) : undefined;
}

/** Index of current policies. */
export function policyIndex(locale: LegalLocale, now: Date): readonly PolicyView[] {
  return POLICY_KEYS.flatMap((k) => {
    const d = currentDocument(k, locale, now);
    return d ? [toView(d, now)] : [];
  });
}

/** Public change log (newest first), effective versions only. */
export function changeLogView(locale: LegalLocale, now: Date): readonly PolicyView[] {
  return changeLog(locale)
    .filter((d) => Date.parse(d.effectiveAt) <= now.getTime())
    .map((d) => toView(d, now));
}
