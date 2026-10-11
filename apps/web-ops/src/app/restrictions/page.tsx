import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { Restrictions } from '../../ui/Compliance';
import { Shell } from '../../ui/Shell';

export default async function RestrictionsPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('restriction.view')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <Restrictions canCreateAccountScope={view.me.permissions.includes('restriction.create_account')} />
    </Shell>
  );
}
