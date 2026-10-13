import { skipToken, useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useAccountState } from '../../../core/account/use-account-state';
import { toApiError } from '../../../core/api/errors';
import { useServerNow } from '../../../core/api/use-server-now';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useIntentNavigation } from '../../../core/intents/use-intents';
import { quoteDetail } from '../../../core/lite/lite-mode';
import { LiteSuggestionBanner, LiteToggle, useLiteMode } from '../../../core/lite/use-lite';
import { resolveStartRoute } from '../../../core/mode/start-route';
import { ModeNoticeBanner, useModeState, useModeSwitch } from '../../../core/mode/use-mode';
import { switchDisabled } from '../../../core/release/client-policy';
import { SoftUpdateBanner, useAppPolicy } from '../../../core/release/AppPolicyGate';
import { useServices, useSessionState } from '../../../core/services/ServicesProvider';
import { Card, ModeSwitch, SkeletonRow, StaleIndicator } from '../../../core/ui/components';
import { Banner, Body, Button, ErrorBanner, Heading, Screen, StateView, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { useRiderFlow } from '../flow/RiderFlowProvider';
import { startCurrentLocation } from '../location/start-location';
import { lastQuoteSummary, placeLine } from '../quote/quote-view';
import { riderHomeModel } from './rider-home';

/**
 * Rider home `/ride` (V08, B01/B02; UX doc §8.1): Where to, pickup, current location (just in time), last price check,
 * application status chip, the Rider | Driver/Partner switch when a driver entry exists, Account, Lite. Booking is not
 * available in Phase 3: there is no request-ride action, only "Booking opens soon".
 */
export function RiderHomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const account = useAccountState();
  const policy = useAppPolicy();
  const flow = useRiderFlow();
  const modeSwitch = useModeSwitch();
  const view = viewStateFromQuery(account, (state) => state);

  if (view.kind !== 'ready') {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('rider.home.title') }} />
        {view.kind === 'loading' ? (
          <>
            <SkeletonRow />
            <SkeletonRow wide={false} />
            <SkeletonRow />
          </>
        ) : (
          <StateView
            state={view}
            emptyKey="common.loading"
            onRetry={() => {
              void account.refetch();
            }}
          />
        )}
      </Screen>
    );
  }
  const model = riderHomeModel({
    account: view.data,
    quotesSwitchedOff: switchDisabled(policy.snapshot, 'rider.quotes'),
    geoDegraded: switchDisabled(policy.snapshot, 'platform.geo-autocomplete') || switchDisabled(policy.snapshot, 'platform.geo-geocode'),
    pickup: flow.draft.pickup,
    locationPhase: flow.location.phase,
  });
  const pickupText =
    model.pickup.kind === 'place'
      ? t('rider.home.pickupPlace', { place: placeLine(t, model.pickup.place) ?? '' })
      : t(model.pickup.kind === 'search-or-pin' ? 'rider.home.pickupSearchOrPin' : 'rider.home.pickupSet');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rider.home.title') }} />
      <Title>{model.name === null ? t('rider.home.greetingNoName') : t('rider.home.greeting', { name: model.name })}</Title>
      <ModeNoticeBanner />
      <SoftUpdateBanner />
      <LiteSuggestionBanner />
      {view.stale !== null ? (
        <Banner
          tone={view.stale.kind === 'offline' ? 'offline' : 'stale'}
          text={t(view.stale.kind === 'offline' ? 'rider.offline.banner' : 'common.staleData')}
        />
      ) : null}
      {model.whereTo.enabled ? (
        <Button
          label={t('rider.home.whereTo')}
          onPress={() => {
            router.push({ pathname: '/ride/search', params: { field: 'dropoff' } });
          }}
        />
      ) : (
        <WhereToDisabled whereTo={model.whereTo} />
      )}
      {model.restrictions.map((r) => (
        <Banner key={r.id} tone="warning" text={t(r.messageKey)} />
      ))}
      {model.deletionPending ? <Banner tone="warning" text={t('deletion.pendingBanner')} /> : null}
      {model.geoDegraded ? <Banner tone="warning" text={t('rider.degraded.search')} /> : null}
      <Card label={pickupText}>
        <Body>{pickupText}</Body>
      </Card>
      {model.whereTo.enabled ? (
        <Button
          variant="secondary"
          label={t('rider.home.changePickup')}
          onPress={() => {
            router.push({ pathname: '/ride/search', params: { field: 'pickup' } });
          }}
        />
      ) : null}
      {model.offerCurrentLocation && model.whereTo.enabled ? (
        <Button
          variant="secondary"
          label={t('rider.location.useCurrent')}
          onPress={() => {
            router.push(startCurrentLocation(flow.location, flow.dispatchLocation));
          }}
        />
      ) : null}
      {model.locationHintKey === null ? null : (
        <>
          <Body muted>{t(model.locationHintKey)}</Body>
          <Button
            variant="secondary"
            label={t('rider.location.openSettings')}
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        </>
      )}
      <LastPriceCheck />
      {model.chipKeys.map((key) => (
        <Body key={key} muted>
          {t(key)}
        </Body>
      ))}
      <Body muted>{t('rider.home.bookingSoon')}</Body>
      <LiteToggle />
      {model.showModeSwitch ? (
        <>
          <Heading>{t('mode.title')}</Heading>
          <ModeSwitch
            value="RIDER"
            riderLabel={t('mode.rider')}
            driverLabel={t('mode.driver')}
            switchToRiderLabel={t('mode.switchToRider')}
            switchToDriverLabel={t('mode.switchToDriver')}
            busy={modeSwitch.busy}
            onSelect={modeSwitch.switchTo}
          />
          {modeSwitch.error === null ? null : <ErrorBanner error={modeSwitch.error} />}
        </>
      ) : null}
      <Button
        variant="secondary"
        label={t('rider.home.account')}
        onPress={() => {
          router.push('/home');
        }}
      />
      <TranslationPendingNote />
    </Screen>
  );
}

function WhereToDisabled({ whereTo }: { readonly whereTo: Extract<ReturnType<typeof riderHomeModel>['whereTo'], { enabled: false }> }) {
  const { t } = useI18n();
  const router = useRouter();
  const { action } = whereTo;
  return (
    <>
      <Button label={t('rider.home.whereTo')} disabled onPress={noop} />
      <Banner tone="warning" text={t(whereTo.reasonKey)} />
      {action.kind === 'appeal' ? (
        <Button
          variant="secondary"
          label={t('restriction.appeal')}
          onPress={() => {
            router.push({ pathname: '/account/appeal', params: { restriction: action.restrictionId } });
          }}
        />
      ) : null}
      {action.kind === 'cancel-deletion' ? (
        <Button
          variant="secondary"
          label={t('deletion.pendingOpen')}
          onPress={() => {
            router.push('/account/delete');
          }}
        />
      ) : null}
    </>
  );
}

const noop = (): void => undefined;

/**
 * "Last price check" (restoration step 7): only the quote-group id and expiry were kept on the phone; the owner-only
 * GET decides what is shown. 404/403 ⇒ forgotten silently. No coordinates or prices come from the device.
 */
function LastPriceCheck() {
  const { t } = useI18n();
  const router = useRouter();
  const session = useSessionState();
  const account = useAccountState();
  const policy = useAppPolicy();
  const lite = useLiteMode();
  const { modes } = useServices();
  const { preference, lastQuote } = useModeState();
  const flow = useRiderFlow();
  const openIntent = useIntentNavigation();
  const serverNow = useServerNow(30_000);
  const [startedAt] = useState(() => Date.now());
  const route = resolveStartRoute(policy.view, session, account.data ?? null, preference, lastQuote, startedAt);
  const groupId = route.kind === 'home' ? route.restoreQuoteGroupId : null;
  const query = useQuery({
    queryKey: ['rider', 'quote-group', groupId ?? 'none'],
    queryFn: groupId === null ? skipToken : () => flow.api.quoteGroup(groupId, quoteDetail(lite.enabled)),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const gone = query.error !== null && [403, 404].includes(toApiError(query.error).detail.status ?? 0);
  useEffect(() => {
    if (gone) void modes.forgetQuote();
  }, [gone, modes]);
  if (groupId === null || gone) return null;
  if (query.data === undefined) {
    return query.isError ? <StaleIndicator text={t('rider.last.unchecked')} /> : <SkeletonRow />;
  }
  const summary = lastQuoteSummary(t, query.data, serverNow);
  return (
    <Card>
      <Heading>{t('rider.last.title')}</Heading>
      {summary.kind === 'priced' ? (
        <>
          <Body>{summary.line}</Body>
          <Button
            variant="secondary"
            label={t('rider.last.continue')}
            onPress={() => {
              openIntent({ kind: 'OPEN_QUOTE', quoteGroupId: groupId });
            }}
          />
        </>
      ) : (
        <>
          <Body>{t('rider.quote.pricesUpdated')}</Body>
          <Button
            variant="secondary"
            label={t('rider.quote.getNewPrice')}
            onPress={() => {
              router.push({ pathname: '/ride/search', params: { field: 'dropoff' } });
            }}
          />
        </>
      )}
      {query.isError ? <StaleIndicator text={t('rider.last.unchecked')} /> : null}
    </Card>
  );
}
