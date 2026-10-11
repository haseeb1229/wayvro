import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { Shell } from '../../ui/Shell';
import { StaffAdmin } from '../../ui/StaffAdmin';

export default async function StaffPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('staff.view_roster')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <StaffAdmin selfId={view.me.staff.id} />
    </Shell>
  );
}
