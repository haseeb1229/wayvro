import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { STRINGS } from '../../content/strings';
import { GeoConsole, type GeoPermissions } from '../../ui/Geo';
import { Shell } from '../../ui/Shell';

/** Geo administration (P3.2; I11/A06): provider budgets, hourly usage, landmark aliases. The API authorises every call. */
export default async function GeoPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const has = (p: string) => view.me.permissions.includes(p);
  if (!has('geo.usage.view')) notFound();
  const can: GeoPermissions = {
    budgetDraft: has('geo.budget.draft'),
    budgetApprove: has('geo.budget.approve'),
    aliasDraft: has('geo.alias.draft'),
    aliasApprove: has('geo.alias.approve'),
  };
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.geo.heading}</h1>
      <GeoConsole selfId={view.me.staff.id} can={can} />
    </Shell>
  );
}
