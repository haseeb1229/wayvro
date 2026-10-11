import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { ReviewQueue } from '../../ui/Review';
import { Shell } from '../../ui/Shell';

export default async function ReviewQueuePage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('kyc.queue.view')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <ReviewQueue />
    </Shell>
  );
}
