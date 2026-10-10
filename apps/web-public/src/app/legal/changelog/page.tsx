import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PolicyList } from '../../../legal/PolicyPage';
import { LEGAL_STRINGS } from '../../../legal/strings';
import { changeLogView, localeFrom } from '../../../legal/view';

export const metadata: Metadata = { title: 'Wayvro — Policy change log', robots: { index: false, follow: false } };

/** `/legal/changelog` — every published version, newest first (W05/R09 policy-change communication). */
export default async function ChangeLogPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const locale = localeFrom((await searchParams)['lang']);
  return (
    <main lang={locale} dir={locale === 'ur' ? 'rtl' : 'ltr'}>
      <h1>{LEGAL_STRINGS[locale].changelogTitle}</h1>
      <PolicyList items={changeLogView(locale, new Date())} locale={locale} showSummary />
    </main>
  );
}
