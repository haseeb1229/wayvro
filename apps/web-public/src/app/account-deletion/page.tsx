import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { DeletionForm } from '../../deletion/DeletionForm';
import { DELETION_STRINGS } from '../../deletion/strings';
import { localeFrom } from '../../legal/view';

interface Props {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Like the legal pages, the wording is not counsel-approved yet (retention schedule pending): keep it out of indexes.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const s = DELETION_STRINGS[localeFrom((await searchParams)['lang'])];
  return { title: s.metaTitle, robots: { index: false, follow: false } };
}

/** `/account-deletion` — the store-required web path to request account deletion without the app (U06). */
export default async function AccountDeletionPage({ searchParams }: Props) {
  // Rendered per request so the proxy's CSP nonce is applied to framework scripts.
  await connection();
  const locale = localeFrom((await searchParams)['lang']);
  const s = DELETION_STRINGS[locale];
  const other = locale === 'ur' ? 'en' : 'ur';
  return (
    <main lang={locale} dir={locale === 'ur' ? 'rtl' : 'ltr'}>
      <nav aria-label={s.otherLanguageLabel}>
        <Link href={locale === 'ur' ? '/account-deletion' : '/account-deletion?lang=ur'} hrefLang={other} lang={other}>
          {s.otherLanguage}
        </Link>
      </nav>
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <section aria-labelledby="deletion-what">
        <h2 id="deletion-what">{s.whatHeading}</h2>
        {s.what.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </section>
      <section aria-labelledby="deletion-grace">
        <h2 id="deletion-grace">{s.graceHeading}</h2>
        {s.grace.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </section>
      <section aria-labelledby="deletion-kept">
        <h2 id="deletion-kept">{s.keptHeading}</h2>
        {s.kept.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p>
          <Link href={`/legal/privacy${locale === 'ur' ? '?lang=ur' : ''}`}>{s.privacyLink}</Link>
        </p>
      </section>
      <section aria-labelledby="deletion-how">
        <h2 id="deletion-how">{s.howHeading}</h2>
        <p>{s.how}</p>
      </section>
      <DeletionForm locale={locale} />
    </main>
  );
}
