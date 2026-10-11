import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { STRINGS } from '../../content/strings';
import { AgePolicies, RequirementSets } from '../../ui/Compliance';
import { Shell } from '../../ui/Shell';

export default async function CompliancePage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('compliance.requirement_set.view')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.compliance.heading}</h1>
      <RequirementSets selfId={view.me.staff.id} />
      {view.me.permissions.includes('legal.age_policy.draft') ? <AgePolicies selfId={view.me.staff.id} /> : null}
    </Shell>
  );
}
