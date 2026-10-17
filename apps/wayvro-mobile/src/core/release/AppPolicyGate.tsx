import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { formatDateTime, isStringKey, type StringKey } from '../i18n/strings';
import { useServices, useSessionState } from '../services/ServicesProvider';
import { Banner, Body, Button, Screen, Title } from '../ui/primitives';
import type { AppPolicyState } from './app-policy-store';
import { isBlocking, isEscapePath, maintenanceRetryDelayMs, type ClientPolicyView } from './client-policy';

/**
 * App-policy gate (A01/Q31; UX doc §9), rendered by AppRoot ABOVE the router: HARD_UPDATE and MAINTENANCE cover every
 * route except the escape hatches, so no path can bypass them. The router stays mounted underneath (hidden from screen
 * readers) so the escape hatches can navigate. Policy is fetched on start and on foreground (≤ once per 15 min);
 * maintenance re-checks back off from 30 s to 5 min. The server enforces every state itself (426 / 503).
 */
export function useAppPolicy(): AppPolicyState {
  const { policy } = useServices();
  return useSyncExternalStore(policy.subscribe, policy.getState);
}

export function AppPolicyGate({ children }: { readonly children: ReactNode }) {
  const { policy } = useServices();
  const state = useAppPolicy();
  const pathname = usePathname();

  useEffect(() => {
    void policy.refresh('start');
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void policy.refresh('foreground');
    });
    return () => {
      subscription.remove();
    };
  }, [policy]);

  const maintenance = state.view.kind === 'maintenance';
  useEffect(() => {
    if (!maintenance) return undefined;
    const timer = setTimeout(() => {
      void policy.refresh('retry');
    }, maintenanceRetryDelayMs(state.maintenanceAttempt));
    return () => {
      clearTimeout(timer);
    };
  }, [maintenance, state.maintenanceAttempt, policy]);

  const blocking = isBlocking(state.view) && !isEscapePath(state.view, pathname);
  return (
    <View style={styles.fill}>
      <View style={styles.fill} importantForAccessibility={blocking ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={blocking}>
        {children}
      </View>
      {blocking ? (
        <View style={styles.overlay}>
          <BlockingScreen
            view={state.view}
            checking={state.checking}
            onRetry={() => {
              void policy.refresh('retry');
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const HARD_REASON_KEY: Readonly<Record<'SECURITY' | 'DATA_CORRUPTION' | 'CONTRACT_BREAK' | 'MINIMUM_BUILD', StringKey>> = {
  SECURITY: 'app.update.reason.SECURITY',
  DATA_CORRUPTION: 'app.update.reason.DATA_CORRUPTION',
  CONTRACT_BREAK: 'app.update.reason.CONTRACT_BREAK',
  MINIMUM_BUILD: 'app.update.reason.MINIMUM_BUILD',
};

function BlockingScreen({ view, checking, onRetry }: { readonly view: ClientPolicyView; readonly checking: boolean; readonly onRetry: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const session = useSessionState();
  const { client, signInFlow } = useServices();
  const signedIn = session.status === 'signed-in';
  const signOut = useMutation({
    mutationFn: () => client.signOut(),
    onSuccess: ({ serverConfirmed }) => {
      signInFlow.setNotice(serverConfirmed ? null : 'signed-out-local-only');
    },
  });
  const escapes = (
    <>
      {signedIn ? (
        <Button
          variant="secondary"
          label={t('app.blocked.legal')}
          onPress={() => {
            router.push('/legal');
          }}
        />
      ) : null}
      {signedIn && view.kind === 'hard-update' ? (
        <Button
          variant="secondary"
          label={t('accountSecurity.delete')}
          onPress={() => {
            router.push('/account/delete');
          }}
        />
      ) : null}
      {signedIn ? (
        <Button
          variant="secondary"
          label={t('common.signOut')}
          busyLabel={t('common.signingOut')}
          busy={signOut.isPending}
          onPress={() => {
            signOut.mutate();
          }}
        />
      ) : null}
      <Body muted>{t('app.blocked.support')}</Body>
    </>
  );
  if (view.kind === 'hard-update') {
    return (
      <Screen topInset>
        <Title>{t('app.update.title')}</Title>
        <Banner tone="error" text={t(view.reasonClass === null ? 'app.update.reason.generic' : HARD_REASON_KEY[view.reasonClass])} announce="blocking" />
        <Body>{t('app.update.fromStore')}</Body>
        {escapes}
      </Screen>
    );
  }
  const messageKey = view.kind === 'maintenance' && view.messageKey !== null && isStringKey(view.messageKey) ? view.messageKey : 'app.maintenance.body';
  const expectedEnd = view.kind === 'maintenance' ? view.expectedEnd : null;
  return (
    <Screen topInset>
      <Title>{t('app.maintenance.title')}</Title>
      <Banner tone="warning" text={t(messageKey)} announce="blocking" />
      {expectedEnd === null ? null : <Body>{t('app.maintenance.until', { time: formatDateTime(expectedEnd, locale) })}</Body>}
      <Body muted>{t('app.maintenance.autoRetry')}</Body>
      <Button label={t('common.retry')} busy={checking} busyLabel={t('app.maintenance.checking')} onPress={onRetry} />
      {escapes}
    </Screen>
  );
}

/** Dismissible soft-update banner for the mode homes (at most once per 24 h after a dismissal). */
export function SoftUpdateBanner() {
  const { policy } = useServices();
  const { t } = useI18n();
  const state = useAppPolicy();
  if (state.view.kind !== 'soft-update' || !state.view.bannerVisible) return null;
  return (
    <View style={styles.soft}>
      <Banner tone="info" text={t('app.softUpdate.body')} />
      <Button
        variant="secondary"
        label={t('app.softUpdate.dismiss')}
        onPress={() => {
          policy.dismissSoftUpdate();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: StyleSheet.absoluteFill,
  soft: { gap: 8 },
});
