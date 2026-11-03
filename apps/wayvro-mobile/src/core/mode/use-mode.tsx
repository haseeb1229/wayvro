import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAccountState } from '../account/use-account-state';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { QUERY_KEYS } from '../query/query-client';
import { useServices } from '../services/ServicesProvider';
import { Banner, Button, Screen, StateView } from '../ui/primitives';
import { errorView, viewStateFromQuery, type UiErrorView } from '../ui/view-state';
import { modeAvailability, type AppMode, type ModeHome } from './availability';
import { driveGuard, planSwitch, type ModeControllerState, type ModeNotice } from './mode-controller';

/** Mode-controller state (preference hint, last quote record, notice). */
export function useModeState(): ModeControllerState {
  const { modes } = useServices();
  return useSyncExternalStore(modes.subscribe, modes.getState);
}

/** The mode home of the current route, or null when the user is elsewhere (a flow screen, the account hub). */
export function currentHome(pathname: string): ModeHome | null {
  return pathname === '/ride' || pathname === '/drive' ? pathname : null;
}

/**
 * Mode switch (UX doc §4.3): refetches the account state FIRST, plans on that fresh server truth, then replaces the
 * stack with the target home (no cross-mode back stack) and stores the preference hint. Onboarding opens on top of the
 * Rider home; an unavailable mode stays put with a notice. The switch never authorises anything.
 */
export function useModeSwitch(): { readonly switchTo: (target: AppMode) => void; readonly busy: boolean; readonly error: UiErrorView | null } {
  const { client, queryClient, modes } = useServices();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiErrorView | null>(null);
  const switchTo = useCallback(
    (target: AppMode) => {
      setBusy(true);
      setError(null);
      queryClient
        .query({ queryKey: QUERY_KEYS.accountState, queryFn: () => client.accountState(), staleTime: 0 })
        .then(async (fresh) => {
          const plan = planSwitch(target, modeAvailability(fresh));
          switch (plan.kind) {
            case 'replace':
              modes.setNotice(null);
              router.replace(plan.href);
              // The preference is a hint: if it cannot be stored, the next start simply opens Rider home.
              await modes.setPreference(fresh.account.id, plan.persist).catch(() => undefined);
              return;
            case 'push':
              router.push(plan.href);
              return;
            case 'stay':
              modes.setNotice(plan.notice);
              return;
          }
        })
        .catch((e: unknown) => {
          setError(errorView(e));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [client, queryClient, modes, router],
  );
  return { switchTo, busy, error };
}

const NOTICE_KEY: Readonly<Record<ModeNotice, StringKey>> = {
  DRIVER_AREA_UNAVAILABLE: 'mode.notice.driverUnavailable',
  RIDER_UNAVAILABLE: 'mode.notice.riderUnavailable',
  OPENED_DRIVER_AREA: 'mode.notice.openedDriver',
  LINK_UNAVAILABLE: 'mode.notice.linkUnavailable',
};

/** One-line notice on the mode homes; dismissible, kept in memory only. */
export function ModeNoticeBanner() {
  const { modes } = useServices();
  const { t } = useI18n();
  const { notice } = useModeState();
  if (notice === null) return null;
  return (
    <View>
      <Banner tone="info" text={t(NOTICE_KEY[notice])} />
      <Button
        variant="secondary"
        label={t('mode.notice.dismiss')}
        onPress={() => {
          modes.setNotice(null);
        }}
      />
    </View>
  );
}

function GuardRedirect({ notice }: { readonly notice: ModeNotice }) {
  const { modes } = useServices();
  useEffect(() => {
    modes.setNotice(notice);
  }, [modes, notice]);
  return <Redirect href="/ride" />;
}

/**
 * Guard of the `/drive/*` graph (T3-18). The server account state is re-fetched whenever the graph gains focus; while
 * it loads, a neutral loading state is shown (never cached driver content). Without a driver home the route is
 * replaced by the Rider home with a one-line reason. Every driver endpoint is re-authorised server-side regardless.
 */
export function DriveModeGuard({ children }: { readonly children: ReactNode }) {
  const account = useAccountState();
  const { refetch } = account;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const view = viewStateFromQuery(account, modeAvailability);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void refetch();
          }}
        />
      </Screen>
    );
  }
  const guard = driveGuard(view.data);
  if (!guard.allowed) return <GuardRedirect notice={guard.notice} />;
  // While the focus refetch runs, a neutral cover hides possibly stale driver content (the navigator stays mounted).
  return (
    <View style={styles.fill}>
      <View style={styles.fill} importantForAccessibility={account.isFetching ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {account.isFetching ? (
        <View style={styles.cover}>
          <Screen scroll={false}>
            <StateView state={{ kind: 'loading' }} emptyKey="common.loading" onRetry={noop} />
          </Screen>
        </View>
      ) : null}
    </View>
  );
}

const noop = (): void => undefined;

const styles = StyleSheet.create({ fill: { flex: 1 }, cover: StyleSheet.absoluteFill });
