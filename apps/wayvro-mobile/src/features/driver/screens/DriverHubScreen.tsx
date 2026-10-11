import type { AccountState, DriverApplication } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, LinkRow, Screen, StateView, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { combineQueries, viewStateFromQuery, type ViewState } from '../../../core/ui/view-state';
import { DRIVER_KEYS, useDriverApplication } from '../api/driver-queries';
import { claimsComplete } from '../onboarding/forms';
import { CLOSED_STATES, hubView, type HubView, type StatusModel } from '../onboarding/status';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import { driverErrorView } from '../ui/driver-errors';
import { DriverErrorBanner, InfoSection, ReasonList, useDriverText } from '../ui/DriverUi';

/**
 * Driver/Partner hub inside the ONE app (P2.8; V03/V01). Shows exactly one view derived from server state: the
 * explanation and start (K14), consent, the application overview, a review/decision status, or the verified driver's
 * compliance view. Rider mode is unaffected throughout; leaving this screen never changes anything server-side.
 */
export default function DriverHubScreen() {
  const dt = useDriverText();
  const { t } = useI18n();
  const { account, application, exists } = useDriverApplication();
  const queue = useUploadQueue();
  const appState = application.data?.state;
  const appId = application.data?.id;

  // Q01: photos of an application that can no longer take evidence are deleted from the phone.
  useEffect(() => {
    if (appId !== undefined && appState !== undefined && CLOSED_STATES.has(appState)) void queue.runner.abandonApplication(appId);
  }, [appId, appState, queue.runner]);

  const combined: ViewState<HubView> =
    exists === true
      ? viewStateFromQuery(combineQueries(account, application), ([a, app]) => hubView(a.driver, app))
      : viewStateFromQuery(account, (a) => hubView(a.driver, null));

  if (combined.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('driver.title') }} />
        <StateView
          state={combined}
          emptyKey="common.loading"
          onRetry={() => {
            void account.refetch();
            void application.refetch();
          }}
        />
      </Screen>
    );
  }
  const view = combined.data;
  if (view.kind === 'compliance') return <Redirect href="/earn/compliance" />;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('driver.title') }} />
      {combined.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      {queue.restoreFailed ? <Banner tone="warning" text={dt('driver.restoreFailed')} /> : null}
      <HubBody view={view} driver={account.data?.driver ?? null} />
      <TranslationPendingNote />
    </Screen>
  );
}

function HubBody({ view, driver }: { readonly view: Exclude<HubView, { kind: 'compliance' }>; readonly driver: AccountState['driver'] | null }) {
  const dt = useDriverText();
  const router = useRouter();
  switch (view.kind) {
    case 'unavailable':
      return (
        <>
          <Title>{dt('driver.title')}</Title>
          <Banner tone="info" text={dt('driver.unavailable')} />
          <BackToAccount />
        </>
      );
    case 'intro':
      return (
        <>
          <Explanation />
          <StartApplication />
        </>
      );
    case 'consent':
      return <Consent application={view.application} />;
    case 'overview':
      return <Overview application={view.application} needsInfo={view.needsInfo} />;
    case 'status':
      return (
        <StatusView
          status={view.status}
          onboardingAvailable={driver?.onboardingAvailable ?? false}
          onAppeal={(decisionId) => {
            router.push({ pathname: '/earn/appeal', params: { decision: decisionId } });
          }}
        />
      );
  }
}

function BackToAccount() {
  const dt = useDriverText();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      label={dt('driver.backToAccount')}
      onPress={() => {
        router.replace('/home');
      }}
    />
  );
}

/** K14: what is collected, why, who sees it, retention (not final), human review, in-person alternative, appeals. */
function Explanation() {
  const dt = useDriverText();
  return (
    <>
      <Title>{dt('explain.title')}</Title>
      <Body>{dt('explain.intro')}</Body>
      <Banner tone="info" text={dt('driver.riderUnaffected')} />
      <InfoSection title="explain.collectTitle" body="explain.collectBody" />
      <InfoSection title="explain.whyTitle" body="explain.whyBody" />
      <InfoSection title="explain.whoTitle" body="explain.whoBody" />
      <InfoSection title="explain.retentionTitle" body="explain.retentionBody" />
      <InfoSection title="explain.decisionTitle" body="explain.decisionBody" />
      <InfoSection title="explain.inPersonTitle" body="explain.inPersonBody" />
      <InfoSection title="explain.correctTitle" body="explain.correctBody" />
      <Body muted>{dt('explain.scope')}</Body>
    </>
  );
}

function useStoreApplication() {
  const queryClient = useQueryClient();
  return (app: DriverApplication) => {
    queryClient.setQueryData(DRIVER_KEYS.application, app);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
  };
}

function StartApplication() {
  const dt = useDriverText();
  const api = useDriverApi();
  const store = useStoreApplication();
  const start = useMutation({ mutationFn: () => api.createApplication(), onSuccess: store });
  return (
    <>
      <DriverErrorBanner error={start.error === null ? null : driverErrorView(start.error)} />
      <Button
        label={dt('explain.start')}
        busyLabel={dt('explain.starting')}
        busy={start.isPending}
        onPress={() => {
          start.mutate();
        }}
      />
      <BackToAccount />
    </>
  );
}

function Consent({ application }: { readonly application: DriverApplication }) {
  const dt = useDriverText();
  const api = useDriverApi();
  const router = useRouter();
  const store = useStoreApplication();
  const consent = useMutation({ mutationFn: () => api.confirmConsent(application.id), onSuccess: store });
  const policiesPending = application.pendingPolicies.length > 0;
  return (
    <>
      <Explanation />
      {policiesPending ? (
        <>
          <Banner tone="info" text={dt('explain.policiesStep')} />
          <Button
            label={dt('explain.reviewPolicies')}
            onPress={() => {
              router.push('/earn/policies');
            }}
          />
        </>
      ) : (
        <>
          <InfoSection title="explain.consentTitle" body="explain.consentBody" />
          <DriverErrorBanner error={consent.error === null ? null : driverErrorView(consent.error)} />
          <Button
            label={dt('explain.consent')}
            busyLabel={dt('explain.consenting')}
            busy={consent.isPending}
            onPress={() => {
              consent.mutate();
            }}
          />
        </>
      )}
      <WithdrawButton application={application} />
      <BackToAccount />
    </>
  );
}

function Overview({
  application,
  needsInfo,
}: {
  readonly application: DriverApplication;
  readonly needsInfo: Extract<HubView, { kind: 'overview' }>['needsInfo'];
}) {
  const dt = useDriverText();
  const router = useRouter();
  const detailsDone = claimsComplete(application);
  const vehicleDone = application.vehicles.length > 0;
  return (
    <>
      <Title>{dt('overview.title')}</Title>
      <Body>{dt('overview.body')}</Body>
      {needsInfo === null ? null : (
        <View style={styles.group}>
          <Banner tone="warning" text={dt('overview.needsInfoTitle')} />
          <Body>{dt('overview.needsInfoBody')}</Body>
          <ReasonList reasons={needsInfo} />
        </View>
      )}
      <LinkRow
        label={dt('overview.details')}
        detail={dt(detailsDone ? 'overview.done' : 'overview.todo')}
        onPress={() => {
          router.push('/earn/details');
        }}
      />
      <LinkRow
        label={dt('overview.vehicle')}
        detail={dt(vehicleDone ? 'overview.done' : 'overview.todo')}
        onPress={() => {
          router.push('/earn/vehicle');
        }}
      />
      <LinkRow
        label={dt('overview.documents')}
        onPress={() => {
          router.push('/earn/documents');
        }}
      />
      <Banner tone="info" text={dt('driver.riderUnaffected')} />
      <WithdrawButton application={application} />
      <BackToAccount />
    </>
  );
}

function WithdrawButton({ application }: { readonly application: DriverApplication }) {
  const dt = useDriverText();
  const { t } = useI18n();
  const api = useDriverApi();
  const queue = useUploadQueue();
  const store = useStoreApplication();
  const withdraw = useMutation({
    mutationFn: () => api.withdraw(application.id),
    onSuccess: async (app) => {
      store(app);
      await queue.runner.abandonApplication(app.id);
    },
  });
  return (
    <>
      <DriverErrorBanner error={withdraw.error === null ? null : driverErrorView(withdraw.error)} />
      <Button
        variant="danger"
        label={dt('overview.withdraw')}
        busyLabel={dt('overview.withdrawing')}
        busy={withdraw.isPending}
        onPress={() => {
          void confirmDestructive({
            title: dt('overview.withdrawConfirmTitle'),
            body: dt('overview.withdrawConfirmBody'),
            confirm: dt('overview.withdraw'),
            cancel: t('common.cancel'),
          }).then((confirmed) => {
            if (confirmed) withdraw.mutate();
          });
        }}
      />
    </>
  );
}

function StatusView(props: { readonly status: StatusModel; readonly onboardingAvailable: boolean; readonly onAppeal: (decisionId: string) => void }) {
  const dt = useDriverText();
  const { locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = props;
  return (
    <>
      <Title>{dt(status.titleKey)}</Title>
      <Banner tone={status.tone} text={dt(status.bodyKey)} />
      {status.submittedAt === null ? null : <Body muted>{dt('status.submittedOn', { date: formatDate(status.submittedAt, locale) })}</Body>}
      {status.decidedAt === null ? null : <Body muted>{dt('status.decidedOn', { date: formatDate(status.decidedAt, locale) })}</Body>}
      <ReasonList reasons={status.reasons} />
      {status.supportNote ? <Body muted>{dt('status.supportPending')}</Body> : null}
      {status.actions.includes('appeal') && status.appealDecisionId !== null ? (
        <Button
          label={dt('status.rejected.appeal')}
          onPress={() => {
            if (status.appealDecisionId !== null) props.onAppeal(status.appealDecisionId);
          }}
        />
      ) : null}
      {status.actions.includes('compliance') ? (
        <Button
          label={dt('status.openCompliance')}
          onPress={() => {
            router.push('/earn/compliance');
          }}
        />
      ) : null}
      {status.actions.includes('start-again') && props.onboardingAvailable ? <StartApplication /> : null}
      {status.actions.includes('refresh') ? (
        <Button
          variant="secondary"
          label={dt('driver.checkUpdates')}
          onPress={() => {
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
            void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
          }}
        />
      ) : null}
      <Banner tone="info" text={dt('driver.riderUnaffected')} />
      {status.actions.includes('start-again') && props.onboardingAvailable ? null : <BackToAccount />}
    </>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
