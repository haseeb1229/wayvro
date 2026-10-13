import { Redirect, usePathname } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { PendingIntentRunner } from '../intents/use-intents';
import { homeOf, modeAvailability } from '../mode/availability';
import { resolveEntry } from '../mode/start-route';
import { useModeState } from '../mode/use-mode';
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
 */
export function AccountGate({ children }: { readonly children: ReactNode }) {
  const session = useSessionState();
  const pathname = usePathname();
  const account = useAccountState();
  const { preference } = useModeState();
  const { locale } = useI18n();
  const { setUiLocale } = useServices();
  const preferredLocale = account.data?.account.preferredLocale;

  useEffect(() => {
    if (preferredLocale !== undefined && preferredLocale !== locale) void setUiLocale(preferredLocale);
  }, [preferredLocale, locale, setUiLocale]);

  if (session.status === 'signed-out') return <Redirect href="/sign-in" />;
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
