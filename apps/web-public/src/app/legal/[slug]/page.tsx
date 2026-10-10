import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PolicyPage } from '../../../legal/PolicyPage';
import { currentPolicyView, localeFrom } from '../../../legal/view';

interface Props {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const view = currentPolicyView((await params).slug, localeFrom((await searchParams)['lang']), new Date());
  if (!view) return {};
  return { title: `Wayvro — ${view.title}`, alternates: { canonical: view.canonicalPath }, robots: { index: !view.placeholder, follow: !view.placeholder } };
}

/** `/legal/<slug>` — the current version (its immutable canonical URL is `/legal/<slug>/v<N>`). */
export default async function CurrentPolicyPage({ params, searchParams }: Props) {
  await connection();
  const view = currentPolicyView((await params).slug, localeFrom((await searchParams)['lang']), new Date());
  if (!view) notFound();
  return <PolicyPage view={view} current={view} />;
}
