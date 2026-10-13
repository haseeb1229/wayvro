import type { QuoteGroup } from '@wayvro/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useServerNow } from '../../../core/api/use-server-now';
import { useI18n } from '../../../core/i18n/I18nProvider';
import type { UiLocale } from '../../../core/i18n/strings';
import { quoteDetail } from '../../../core/lite/lite-mode';
import { useLiteMode } from '../../../core/lite/use-lite';
import { useServices } from '../../../core/services/ServicesProvider';
import { ConfidenceBadge, Countdown, QuoteOptionCard, SkeletonRow, StaleIndicator } from '../../../core/ui/components';
import { Banner, Body, Button, Heading, Screen, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { quoteInput, quotePoint } from '../flow/draft';
import { useRiderFlow } from '../flow/RiderFlowProvider';
import { announcementFor, countdownState, countdownText } from './countdown';
import { earliestExpiry, pricedView, quoteRefusal, refusalCopy, routingRetryDelayMs, type QuoteRefusal } from './quote-view';

/**
 * Route summary + quote options `/ride/quote` (B03/B04/B06; E07/CON-P3-08; UX doc §8.4). Prices, expiry and
 * availability come from the server only. Refusals are states of THIS route (no dead-end error routes in the back
 * stack). "Get new price" is a NEW price check with a new Idempotency-Key; a retry after an unknown outcome reuses the
 * key. No automatic re-pricing; Lite offers a manual "Refresh prices". No request-ride action exists in Phase 3.
 */
type Run =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly group: QuoteGroup }
  | { readonly status: 'error'; readonly refusal: QuoteRefusal; readonly group: QuoteGroup | null };

/** What the next server call is: price a new attempt, or read an existing group (restore, intent, Lite refresh). */
type Call = { readonly kind: 'create'; readonly attempt: string } | { readonly kind: 'read'; readonly quoteGroupId: string };

export function QuoteScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { newUuid, modes, clock } = useServices();
  const flow = useRiderFlow();
  const lite = useLiteMode();
  const serverNow = useServerNow(1000);
  const groupParam = typeof params['group'] === 'string' ? params['group'] : null;
  const input = quoteInput(flow.draft);
  const [call, setCall] = useState<Call>(() => (groupParam === null ? { kind: 'create', attempt: newUuid() } : { kind: 'read', quoteGroupId: groupParam }));
  const [runKey, setRunKey] = useState(0);
  const [run, setRun] = useState<Run>({ status: 'loading' });
  const [retryAt, setRetryAt] = useState(0);

  // The latest inputs, read by the server call when an explicit action starts it (typing elsewhere never re-prices).
  const latest = useRef({ flow, input, detail: quoteDetail(lite.enabled), retries: 0, modes });
  useEffect(() => {
    latest.current = { ...latest.current, flow, input, detail: quoteDetail(lite.enabled), modes };
  });

  useEffect(() => {
    const { flow: f, input: trip, detail } = latest.current;
    const request =
      call.kind === 'read'
        ? f.api.quoteGroup(call.quoteGroupId, detail)
        : trip === null
          ? null
          : f.api.createQuote(call.attempt, quotePoint(trip.pickup), quotePoint(trip.dropoff), detail);
    if (request === null) return undefined;
    let active = true;
    request.then(
      (group) => {
        if (!active) return;
        latest.current.retries = 0;
        setRun({ status: 'done', group });
        f.setGroup(group);
        const expiry = earliestExpiry(group);
        // The restoration record is a convenience: if it cannot be stored, a restart simply shows no last price check.
        if (expiry !== null) latest.current.modes.rememberQuote(group.quoteGroupId, expiry).catch(() => undefined);
      },
      (error: unknown) => {
        if (!active) return;
        const refusal = quoteRefusal(error, f.draft);
        setRun((previous) => ({ status: 'error', refusal, group: previous.status === 'loading' ? null : previous.group }));
        if (refusal.kind === 'routing-unavailable') setRetryAt(Date.now() + routingRetryDelayMs(latest.current.retries));
        if (refusal.kind === 'rate-limited' && refusal.seconds !== null) setRetryAt(Date.now() + refusal.seconds * 1000);
        latest.current.retries += 1;
      },
    );
    return () => {
      active = false;
    };
  }, [call, runKey]);

  const retry = (): void => {
    setRun((previous) => (previous.status === 'error' && previous.group !== null ? previous : { status: 'loading' }));
    setRunKey((n) => n + 1);
  };
  const getNewPrice = (): void => {
    if (input === null) {
      router.replace({ pathname: '/ride/search', params: { field: 'dropoff' } });
      return;
    }
    latest.current.retries = 0;
    setRun({ status: 'loading' });
    setCall({ kind: 'create', attempt: newUuid() });
  };
  const refresh = (): void => {
    if (run.status !== 'done') return;
    setCall({ kind: 'read', quoteGroupId: run.group.quoteGroupId });
    setRunKey((n) => n + 1);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rider.quote.title') }} />
      <Title>{t('rider.quote.title')}</Title>
      <QuoteBody
        run={run}
        noInput={input === null && call.kind === 'create'}
        serverNow={serverNow}
        retryInS={Math.max(0, Math.ceil((retryAt - (serverNow - clock.offsetMs)) / 1000))}
        lite={lite.enabled}
        locale={locale}
        onRetry={retry}
        onNewPrice={getNewPrice}
        onChange={(field) => {
          router.replace({ pathname: '/ride/search', params: { field } });
        }}
        onDetails={(quoteId) => {
          router.push({ pathname: '/ride/fare', params: { quote: quoteId } });
        }}
        onRefresh={refresh}
      />
      <Body muted>{t('rider.home.bookingSoon')}</Body>
      <TranslationPendingNote />
    </Screen>
  );
}

function QuoteBody(props: {
  readonly run: Run;
  readonly noInput: boolean;
  readonly serverNow: number;
  readonly retryInS: number;
  readonly lite: boolean;
  readonly locale: UiLocale;
  readonly onRetry: () => void;
  readonly onNewPrice: () => void;
  readonly onChange: (field: 'pickup' | 'dropoff') => void;
  readonly onDetails: (quoteId: string) => void;
  readonly onRefresh: () => void;
}) {
  const { t } = useI18n();
  const { draft } = useRiderFlow();
  const { run } = props;
  if (props.noInput) {
    return (
      <>
        <Banner tone="info" text={t('rider.quote.chooseTrip')} />
        <Button
          label={t('rider.home.whereTo')}
          onPress={() => {
            props.onChange('dropoff');
          }}
        />
      </>
    );
  }
  if (run.status === 'loading') {
    return (
      <View style={styles.group}>
        <Banner tone="info" text={t('rider.quote.loading')} />
        <SkeletonRow />
        <SkeletonRow wide={false} />
      </View>
    );
  }
  const group = run.group;
  // An outage, refusal or offline answer without earlier prices: no price is shown rather than a guess.
  if (run.status === 'error' && group === null) {
    const copy = refusalCopy(t, run.refusal);
    const waiting = copy.action === 'retry' && props.retryInS > 0;
    return (
      <View style={styles.group}>
        <Heading>{copy.title}</Heading>
        <Banner tone={run.refusal.kind === 'offline' ? 'offline' : 'warning'} text={copy.body} />
        {copy.action === 'retry' ? (
          <Button label={waiting ? t('rider.quote.retryIn', { seconds: props.retryInS }) : t('common.retry')} disabled={waiting} onPress={props.onRetry} />
        ) : null}
        {copy.action === 'change-pickup' || copy.action === 'change-trip' ? (
          <Button
            variant="secondary"
            label={t('rider.quote.changePickup')}
            onPress={() => {
              props.onChange('pickup');
            }}
          />
        ) : null}
        {copy.action === 'change-dropoff' || copy.action === 'change-trip' ? (
          <Button
            variant="secondary"
            label={t('rider.quote.changeDropoff')}
            onPress={() => {
              props.onChange('dropoff');
            }}
          />
        ) : null}
      </View>
    );
  }
  if (group === null) return null;
  const view = pricedView(t, props.locale, group, draft, props.serverNow);
  const announcer = [...view.options].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];
  return (
    <View style={styles.group}>
      {run.status === 'error' ? <StaleIndicator text={t('rider.quote.couldNotRefresh')} /> : null}
      {view.route.from === null ? null : <Body>{t('rider.quote.from', { place: view.route.from })}</Body>}
      {view.route.to === null ? null : <Body>{t('rider.quote.to', { place: view.route.to })}</Body>}
      <Body>{view.route.summary}</Body>
      <ConfidenceBadge level={view.route.confidenceLevel} text={view.route.confidence} />
      {view.route.snappedPickup === null ? null : <Banner tone="info" text={view.route.snappedPickup} />}
      {view.anyExpired ? (
        <>
          <Banner tone="warning" text={t('rider.quote.pricesUpdated')} />
          <Button label={t('rider.quote.getNewPrice')} onPress={props.onNewPrice} />
        </>
      ) : null}
      {view.options.length === 0 && view.unavailable.length === 0 ? <Body muted>{t('rider.quote.noOptions')}</Body> : null}
      {view.options.map((option) => {
        const remaining = countdownState(option.expiresAt, props.serverNow).remainingS;
        const validity = option.expired ? t('rider.quote.expiredLabel') : t('rider.quote.validFor', { time: countdownText(remaining) });
        const due = announcementFor(remaining);
        const announcement =
          option.quoteId !== announcer?.quoteId || due === null ? null : t(due === 'EXPIRED' ? 'rider.quote.pricesUpdated' : 'rider.quote.oneMinuteLeft');
        return (
          <QuoteOptionCard
            key={option.quoteId}
            title={option.title}
            lines={option.lines}
            price={option.price}
            expired={option.expired}
            label={option.expired ? option.spoken : `${option.spoken}. ${t('rider.quote.validSpoken', { minutes: Math.max(1, Math.ceil(remaining / 60)) })}`}
            detailsLabel={t('rider.quote.details')}
            onDetails={() => {
              props.onDetails(option.quoteId);
            }}
            countdown={<Countdown text={validity} announcement={announcement} />}
          />
        );
      })}
      {view.unavailable.map((row) => (
        <QuoteOptionCard key={row.productCode} title={row.title} lines={[row.reason]} price={null} expired label={`${row.title}. ${row.reason}`} />
      ))}
      {view.route.attribution === null ? null : <Body muted>{view.route.attribution}</Body>}
      {props.lite ? <Button variant="secondary" label={t('lite.refreshPrices')} onPress={props.onRefresh} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.md } });
