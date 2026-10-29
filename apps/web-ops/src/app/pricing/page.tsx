import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { STRINGS } from '../../content/strings';
import { PricingConsole, type PricingPermissions } from '../../ui/Pricing';
import { Shell } from '../../ui/Shell';

/** Pricing administration (P3.3; H06/E05/B06): tax policies, rate cards, previews, support quote lookup. The API authorises every call. */
export default async function PricingPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const has = (p: string) => view.me.permissions.includes(p);
  if (!has('pricing.view')) notFound();
  const can: PricingPermissions = {
    taxDraft: has('pricing.tax_policy.draft'),
    taxApprove: has('pricing.tax_policy.approve'),
    cardDraft: has('pricing.rate_card.draft'),
    cardSubmit: has('pricing.rate_card.submit'),
    cardApprove: has('pricing.rate_card.approve'),
    cardActivate: has('pricing.rate_card.activate'),
    cardRollback: has('pricing.rate_card.rollback'),
    preview: has('pricing.preview'),
    quoteView: has('pricing.quote.view'),
  };
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.pricing.heading}</h1>
      <p>{STRINGS.pricing.note}</p>
      <PricingConsole selfId={view.me.staff.id} can={can} />
    </Shell>
  );
}
