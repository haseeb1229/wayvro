import { Redirect } from 'expo-router';
import { useSessionState } from '../services/ServicesProvider';

/** App entry ("/"): signed in ⇒ the account area (its gate applies the server's required actions), else sign-in. */
export function EntryRedirect() {
  const session = useSessionState();
  return <Redirect href={session.status === 'signed-in' ? '/home' : '/sign-in'} />;
}
