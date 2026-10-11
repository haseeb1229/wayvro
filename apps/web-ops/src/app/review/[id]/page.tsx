import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../../bff/session';
import { ReviewCase } from '../../../ui/Review';
import { Shell } from '../../../ui/Shell';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function ReviewCasePage({ params }: { readonly params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  if (!view.me.permissions.includes('kyc.case.view_masked')) notFound();
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <ReviewCase caseId={id} viewer={view.me.staff.displayName} canSecondApprove={view.me.permissions.includes('kyc.decision.second_approve')} />
    </Shell>
  );
}
