import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentStaff } from '../bff/session';
import { STRINGS } from '../content/strings';
import { Shell } from '../ui/Shell';

/** Overview: own roles, key count (two-authenticator rule) and banners. Privileged data lives on scoped pages. */
export default async function OpsHomePage() {
  await connection();
  const view = await currentStaff();
  if (view.state === 'SIGNED_OUT') redirect('/login');
  const { me } = view;
  return (
    <Shell me={me} initiallyLocked={view.state === 'LOCKED'}>
      <h1>{STRINGS.title}</h1>
      <h2>{STRINGS.home.roles}</h2>
      {me.roles.length === 0 ? (
        <p>{STRINGS.home.noRoles}</p>
      ) : (
        <ul>
          {me.roles.map((r) => (
            <li key={r.assignmentId}>
              {r.role}
              {r.cities.length ? ` (${r.cities.join(', ')})` : ''}
            </li>
          ))}
        </ul>
      )}
      <h2>{STRINGS.home.keys}</h2>
      <p>{me.activeCredentials}</p>
      {me.twoAuthenticatorRuleSatisfied ? null : <p role="note">{STRINGS.home.twoKeys}</p>}
    </Shell>
  );
}
