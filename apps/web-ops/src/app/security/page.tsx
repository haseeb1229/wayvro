import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { SecurityKeys } from '../../ui/Oversight';
import { Shell } from '../../ui/Shell';

export default async function SecurityPage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  return (
    <Shell me={view.me} initiallyLocked={view.state === 'LOCKED'}>
      <SecurityKeys />
    </Shell>
  );
}
