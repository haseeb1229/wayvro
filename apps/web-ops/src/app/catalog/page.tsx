import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { STRINGS } from '../../content/strings';
import { CityProducts, EligibilityRules, type CatalogPermissions } from '../../ui/Catalog';
import { Shell } from '../../ui/Shell';

export default async function CatalogPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const has = (p: string) => view.me.permissions.includes(p);
  if (!has('catalog.view')) notFound();
  const can: CatalogPermissions = {
    enableRequest: has('catalog.product.enable_request'),
    enableApprove: has('catalog.product.enable_approve'),
    suspend: has('catalog.product.suspend'),
    ruleDraft: has('catalog.eligibility_rule.draft'),
    ruleApprove: has('catalog.eligibility_rule.approve'),
    ruleActivate: has('catalog.eligibility_rule.activate'),
    zoneDraft: has('catalog.zone_set.draft'),
    zoneApprove: has('catalog.zone_set.approve'),
    zoneActivate: has('catalog.zone_set.activate'),
  };
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.catalog.heading}</h1>
      <CityProducts selfId={view.me.staff.id} can={can} />
      <EligibilityRules selfId={view.me.staff.id} can={can} />
    </Shell>
  );
}
