import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { AuditView } from '../../ui/Oversight';
import { EvidenceAccessLog } from '../../ui/Review';
import { Shell } from '../../ui/Shell';

export default async function AuditPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('audit.events.view')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <AuditView />
      {view.me.permissions.includes('audit.evidence_access.view') ? <EvidenceAccessLog /> : null}
    </Shell>
  );
}
