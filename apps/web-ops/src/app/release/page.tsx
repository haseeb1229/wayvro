import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../../bff/session';
import { STRINGS } from '../../content/strings';
import { ReleaseControls, VersionPolicies } from '../../ui/Release';
import { Shell } from '../../ui/Shell';

/** Release controls (P3.4; A01/Q31/V10): version policies, maintenance and runtime switches. The API authorises every call. */
export default async function ReleasePage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const { me } = view;
  if (!me.permissions.includes('release.view')) notFound();
  const can = (p: string) => me.permissions.includes(p);
  return (
    <Shell me={me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.release.heading}</h1>
      <p>{STRINGS.release.note}</p>
      <ReleaseControls
        selfId={me.staff.id}
        canStop={can('platform.switch.disable')}
        canRequestRestore={can('platform.switch.enable_request')}
        canApproveRestore={can('platform.switch.enable_approve')}
      />
      <VersionPolicies
        selfId={me.staff.id}
        canDraft={can('release.policy.draft')}
        canApprove={can('release.policy.approve')}
        canActivate={can('release.policy.activate')}
      />
    </Shell>
  );
}
