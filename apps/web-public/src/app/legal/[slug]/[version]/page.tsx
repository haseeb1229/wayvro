import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PolicyPage } from '../../../../legal/PolicyPage';
import { currentPolicyView, localeFrom, versionedPolicyView } from '../../../../legal/view';

interface Props {
  readonly params: Promise<{ slug: string; version: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const p = await params;
  const view = versionedPolicyView(p.slug, p.version, localeFrom((await searchParams)['lang']), new Date());
  if (!view) return {};
  return { title: `Wayvro — ${view.title} (v${String(view.version)})`, robots: { index: !view.placeholder, follow: !view.placeholder } };
}

/** `/legal/<slug>/v<N>` — one immutable, dated version (W05). */
export default async function VersionedPolicyPage({ params, searchParams }: Props) {
  await connection();
  const p = await params;
  const locale = localeFrom((await searchParams)['lang']);
  const now = new Date();
  const view = versionedPolicyView(p.slug, p.version, locale, now);
  if (!view) notFound();
  return <PolicyPage view={view} current={currentPolicyView(p.slug, locale, now)} />;
}
