import { Redirect } from 'expo-router';
import { useState } from 'react';
import { resolveStartRoute } from '../mode/start-route';
import { useModeState } from '../mode/use-mode';
import { useAppPolicy } from '../release/AppPolicyGate';
import { useSessionState } from '../services/ServicesProvider';
import { Screen, StateView } from '../ui/primitives';
import { viewStateFromQuery } from '../ui/view-state';
import { useAccountState } from './use-account-state';

/**
 * App entry ("/"; cold start, after sign-in, after any system path): the restoration resolver decides — app policy,
 * session, required actions, server mode availability, then the stored mode preference (a hint) — and the app lands
 * on that mode home (`/ride` or `/drive`).
 */
export function EntryRedirect() {
  const session = useSessionState();
  if (session.status !== 'signed-in') return <Redirect href="/sign-in" />;
  return <SignedInEntry />;
}

function SignedInEntry() {
  const session = useSessionState();
  const account = useAccountState();
  const policy = useAppPolicy();
  const { preference, lastQuote } = useModeState();
  const [now] = useState(() => Date.now());
  const route = resolveStartRoute(policy.view, session, account.data ?? null, preference, lastQuote, now);
  switch (route.kind) {
    case 'sign-in':
      return <Redirect href="/sign-in" />;
    case 'required-action':
    case 'home':
      return <Redirect href={route.href} />;
    case 'blocked':
    case 'loading': {
      // Blocked: the app-policy gate covers this screen. Loading: the account state is still arriving (or failed).
      const view = viewStateFromQuery(account, (state) => state);
      return (
        <Screen scroll={false}>
          <StateView
            state={view.kind === 'error' ? view : { kind: 'loading' }}
            emptyKey="common.loading"
            onRetry={() => {
              void account.refetch();
            }}
          />
        </Screen>
      );
    }
  }
}
