import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useIntentNavigation } from '../../../core/intents/use-intents';
import { ModeNoticeBanner, useModeSwitch } from '../../../core/mode/use-mode';
import { SoftUpdateBanner } from '../../../core/release/AppPolicyGate';
import { ModeSwitch, SkeletonRow } from '../../../core/ui/components';
import { Banner, Body, Button, ErrorBanner, LinkRow, Screen, StateView, Title } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { readLocationStatus } from '../../../platform/location/status';
import { useCompliance } from '../api/driver-queries';
import type { DriverStringKey } from '../i18n/driver-strings';
import { markGlyph, markKey } from '../readiness/marks';
import { readinessModel, type LocationReadiness, type ReadinessHeadline, type ReadinessRow } from '../readiness/readiness';
import { useDriverText } from '../ui/DriverUi';

const HEADLINE_KEY: Readonly<Record<ReadinessHeadline, DriverStringKey>> = {
  ready: 'drive.ready',
  attention: 'drive.notReady',
  unknown: 'drive.intro',
};

/**
 * Driver/Partner home `/drive` (lazy; K19 surfacing, V13): a readiness checklist from the server's compliance view and
 * account state — profile, documents, per-product eligibility, restrictions, and location (READ-ONLY status, never a
 * request). No "Go online", no online state, no offers, no background location: driving opens in a later phase.
 * Offline: the last loaded server data stays visible with a stale notice; nothing is recomputed on the device.
 */
export default function DriveHomeScreen() {
  const dt = useDriverText();
  const { t } = useI18n();
  const router = useRouter();
  const account = useAccountState();
  const compliance = useCompliance();
  const modeSwitch = useModeSwitch();
  const openIntent = useIntentNavigation();
  const [location, setLocation] = useState<LocationReadiness>('unknown');

  useEffect(() => {
    let active = true;
    readLocationStatus().then(
      (snapshot) => {
        if (active) setLocation(snapshot.status === 'granted' ? 'allowed' : 'not-yet');
      },
      () => {
        // Unreadable: the row keeps saying location will be asked when driving opens.
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const view = viewStateFromQuery(account, (state) => state);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('drive.title') }} />
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
  const model = readinessModel(view.data, compliance.data ?? null, location);
  // cached server data after a failed refresh (offline or error): shown, marked stale
  const stale = view.stale !== null || (compliance.data !== undefined && compliance.isError);
  const open = (row: ReadinessRow): void => {
    switch (row.target.kind) {
      case 'compliance':
        openIntent({ kind: 'OPEN_DRIVER_COMPLIANCE' });
        return;
      case 'renewal':
        openIntent({ kind: 'OPEN_DOCUMENT_RENEWAL', documentId: row.target.documentId });
        return;
      case 'route':
        router.push(row.target.pathname);
        return;
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('drive.title') }} />
      <Title>{dt('drive.title')}</Title>
      <ModeNoticeBanner />
      <SoftUpdateBanner />
      <ModeSwitch
        value="DRIVER"
        riderLabel={t('mode.rider')}
        driverLabel={t('mode.driver')}
        switchToRiderLabel={t('mode.switchToRider')}
        switchToDriverLabel={t('mode.switchToDriver')}
        busy={modeSwitch.busy}
        onSelect={modeSwitch.switchTo}
      />
      {modeSwitch.error === null ? null : <ErrorBanner error={modeSwitch.error} />}
      {stale ? <Banner tone="stale" text={t('common.staleData')} /> : null}
      <Body>{dt(HEADLINE_KEY[model.headline])}</Body>
      {compliance.data === undefined && compliance.isPending ? <SkeletonRow /> : null}
      {model.partial && compliance.isError ? (
        <>
          <Banner tone="warning" text={dt('drive.partial')} />
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => {
              void compliance.refetch();
            }}
          />
        </>
      ) : null}
      {model.rows.map((row) => (
        <LinkRow
          key={row.id}
          glyph={markGlyph(row.mark)}
          label={dt(row.key, { count: row.count ?? 0, state: row.stateKey === null ? '' : dt(row.stateKey) })}
          detail={dt(markKey(row.mark))}
          onPress={() => {
            open(row);
          }}
        />
      ))}
      <Banner tone={model.accountRestricted ? 'warning' : 'info'} text={dt(model.accountRestricted ? 'drive.accountRestricted' : 'drive.riderUnaffected')} />
      <Button
        variant="secondary"
        label={t('rider.home.account')}
        onPress={() => {
          router.push('/home');
        }}
      />
    </Screen>
  );
}
