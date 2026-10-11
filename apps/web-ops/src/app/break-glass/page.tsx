import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { BreakGlassView } from '../../ui/Oversight';
import { Shell } from '../../ui/Shell';

export default async function BreakGlassPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const canActivate = view.me.permissions.includes('breakglass.activate');
  const canReview = view.me.permissions.includes('breakglass.review');
  if (!canActivate && !canReview) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <BreakGlassView canActivate={canActivate} canReview={canReview} selfId={view.me.staff.id} />
    </Shell>
  );
}
