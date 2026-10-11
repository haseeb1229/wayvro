import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { PolicyList } from '../../legal/PolicyPage';
import { LEGAL_STRINGS } from '../../legal/strings';
import { localeFrom, policyIndex } from '../../legal/view';

// Every current text is a placeholder until counsel approval (EG-02): keep the pages out of search indexes.
export const metadata: Metadata = { title: 'Wayvro — Legal', robots: { index: false, follow: false } };

export default async function LegalIndexPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const locale = localeFrom((await searchParams)['lang']);
  const s = LEGAL_STRINGS[locale];
  return (
    <main lang={locale} dir={locale === 'ur' ? 'rtl' : 'ltr'}>
      <h1>{s.indexTitle}</h1>
      <p>{s.indexIntro}</p>
      <PolicyList items={policyIndex(locale, new Date())} locale={locale} showSummary={false} />
      <p>
        <Link href={`/legal/changelog${locale === 'ur' ? '?lang=ur' : ''}`}>{s.changelogLink}</Link>
        <span aria-hidden="true"> · </span>
        <Link href={locale === 'ur' ? '/legal' : '/legal?lang=ur'} hrefLang={locale === 'ur' ? 'en' : 'ur'} aria-label={s.otherLanguageLabel}>
          {s.otherLanguage}
        </Link>
      </p>
    </main>
  );
}
