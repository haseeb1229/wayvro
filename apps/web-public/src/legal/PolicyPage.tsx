import Link from 'next/link';
import { LEGAL_STRINGS } from './strings';
import type { LegalLocale, PolicyView } from './view';

const langQuery = (locale: LegalLocale): string => (locale === 'ur' ? '?lang=ur' : '');
const other = (locale: LegalLocale): LegalLocale => (locale === 'ur' ? 'en' : 'ur');

/** Placeholder banner shown on every non-approved text (W05, CL-P2-09). */
function PlaceholderBanner({ locale }: { readonly locale: LegalLocale }) {
  return (
    <p role="alert" data-testid="placeholder-banner">
      <strong>{LEGAL_STRINGS[locale].placeholderBanner}</strong>
    </p>
  );
}

/** One policy version: metadata, banner, sections; links to the current version when superseded. */
export function PolicyPage({ view, current }: { readonly view: PolicyView; readonly current: PolicyView | undefined }) {
  const s = LEGAL_STRINGS[view.locale];
  return (
    <main lang={view.locale} dir={view.locale === 'ur' ? 'rtl' : 'ltr'}>
      <nav aria-label="breadcrumb">
        <Link href={`/legal${langQuery(view.locale)}`}>{s.back}</Link>
        <span aria-hidden="true"> · </span>
        <Link href={`${view.canonicalPath}${langQuery(other(view.locale))}`} hrefLang={other(view.locale)} aria-label={s.otherLanguageLabel}>
          {s.otherLanguage}
        </Link>
      </nav>
      <h1>{view.title}</h1>
      {view.placeholder ? <PlaceholderBanner locale={view.locale} /> : null}
      <dl>
        <dt>{s.version}</dt>
        <dd>{view.version}</dd>
        <dt>{s.effective}</dt>
        <dd>
          <time dateTime={view.effectiveDate}>{view.effectiveDate}</time>
        </dd>
        <dt>{s.summary}</dt>
        <dd>{view.changeSummary}</dd>
      </dl>
      {!view.isCurrent && current ? (
        <p>
          {s.superseded} <Link href={`${current.canonicalPath}${langQuery(view.locale)}`}>{current.title}</Link>
        </p>
      ) : null}
      {view.sections.map((section, i) => (
        <section key={section.heading} aria-labelledby={`section-${String(i)}`}>
          <h2 id={`section-${String(i)}`}>{section.heading}</h2>
          {section.paragraphs.length > 2 ? (
            <ul>
              {section.paragraphs.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            section.paragraphs.map((p) => <p key={p}>{p}</p>)
          )}
        </section>
      ))}
      <footer>
        <p>
          {s.fingerprint}: <code>{view.contentSha256}</code>
        </p>
      </footer>
    </main>
  );
}

/** List of policy versions (index and change log). */
export function PolicyList({
  items,
  locale,
  showSummary,
}: {
  readonly items: readonly PolicyView[];
  readonly locale: LegalLocale;
  readonly showSummary: boolean;
}) {
  const s = LEGAL_STRINGS[locale];
  return (
    <ul>
      {items.map((v) => (
        <li key={`${v.slug}-${String(v.version)}`}>
          <Link href={`${v.canonicalPath}${langQuery(locale)}`}>{v.title}</Link> — {s.version} {v.version}, {s.effective}{' '}
          <time dateTime={v.effectiveDate}>{v.effectiveDate}</time>
          {v.placeholder ? ` — ${s.placeholderBanner}` : ''}
          {showSummary ? <p>{v.changeSummary}</p> : null}
        </li>
      ))}
    </ul>
  );
}
