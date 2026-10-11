import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { Shell } from '../../ui/Shell';
import { SupportConsole } from '../../ui/Support';

export default async function SupportPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const can = (p: string) => view.me.permissions.includes(p);
  if (!can('account.summary.view_masked')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <SupportConsole canRevoke={can('account.sessions.revoke_on_behalf')} canAssist={can('account.recovery_case.open')} />
    </Shell>
  );
}
