import { Redirect, usePathname } from 'expo-router';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { PendingIntentRunner } from '../intents/use-intents';
import { homeOf, modeAvailability } from '../mode/availability';
import { resolveEntry } from '../mode/start-route';
import { useModeState } from '../mode/use-mode';
import { rendersWithoutAccountState } from '../release/client-policy';
import { useServices, useSessionState } from '../services/ServicesProvider';
import { Screen, StateView } from '../ui/primitives';
import { viewStateFromQuery } from '../ui/view-state';
import { redirectFor } from './account-route';
import { useAccountState } from './use-account-state';

/**
 * Guard of every signed-in route. Signed out ⇒ sign-in. Otherwise the SERVER account state decides the allowed screen
 * (required actions first; without one, stale onboarding screens go to the mode home chosen by the restoration
 * resolver); it is re-fetched on start, on foreground and after mutations, so a restart, deep link or stale navigation
 * stack always converges on server truth. Held system intents are replayed only after this gate opens. The UI language
 * follows the account's preferred locale.
 *
 * Under HARD_UPDATE / MAINTENANCE the server answers the account state with 426 / 503 (ADR-049), so the escape screens
 * the AppPolicyGate leaves reachable (legal reads; the in-app deletion path under HARD_UPDATE) render without it: they
 * call only exempt endpoints, and no other route is uncovered (SP-08 #21).
 */
export function AccountGate({ children }: { readonly children: ReactNode }) {
  const session = useSessionState();
  const pathname = usePathname();
  const account = useAccountState();
  const { preference } = useModeState();
  const { locale } = useI18n();
  const { setUiLocale, policy } = useServices();
  const policyView = useSyncExternalStore(policy.subscribe, policy.getState).view;
  const preferredLocale = account.data?.account.preferredLocale;

  useEffect(() => {
    if (preferredLocale !== undefined && preferredLocale !== locale) void setUiLocale(preferredLocale);
  }, [preferredLocale, locale, setUiLocale]);

  if (session.status === 'signed-out') return <Redirect href="/sign-in" />;
  if (rendersWithoutAccountState(policyView, pathname)) return <>{children}</>;
  const view = viewStateFromQuery(account, (state) => state);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void account.refetch();
          }}
        />
      </Screen>
    );
  }
  const modeHome = homeOf(resolveEntry(modeAvailability(view.data), preference, view.data.account.id));
  const target = redirectFor(view.data.requiredActions, pathname, modeHome);
  if (target !== null) return <Redirect href={target} />;
  return (
    <>
      {children}
      <PendingIntentRunner account={view.data} />
    </>
  );
}
