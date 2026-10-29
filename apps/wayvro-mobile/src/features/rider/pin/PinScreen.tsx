import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useLiteMode } from '../../../core/lite/use-lite';
import { useAppPolicy } from '../../../core/release/AppPolicyGate';
import { Card } from '../../../core/ui/components';
import { Banner, Body, Button, Heading, Screen } from '../../../core/ui/primitives';
import { startCurrentLocation } from '../location/start-location';
import { watchPickupFix } from '../../../platform/location/request';
import { useRiderFlow } from '../flow/RiderFlowProvider';
import { pinView, type ReverseState } from './pin-view';

/**
 * Pin `/ride/pin` — TEXT-FIRST until the P3.7 map renderer (no renderer is frozen): the current-location fix is
 * reverse-geocoded and offered as "Is this your pickup?"; the rider confirms. A scoped watch (≥ 5 s, ≥ 10 m) runs only
 * while this screen is focused and the app is active (never in Lite unless tapped), and stops on blur, background,
 * sign-out (the graph unmounts) and revocation. Search stays one tap away; nothing here is persisted.
 */
export function PinScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const flow = useRiderFlow();
  const lite = useLiteMode();
  const policy = useAppPolicy();
  const [reverse, setReverse] = useState<ReverseState>({ kind: 'idle' });
  const [lookupRequested, setLookupRequested] = useState(false);
  const { location, dispatchLocation, receiveFix, fix } = flow;

  const tapUseCurrent = (): void => {
    if (startCurrentLocation(location, dispatchLocation) === '/ride/location') router.push({ pathname: '/ride/location', params: { from: 'pin' } });
  };

  const preciseGranted = location.accuracy === 'precise' && (location.phase === 'GRANTED_PRECISE' || location.phase === 'FIX_OK');
  const watchAllowed = preciseGranted && (!lite.enabled || lookupRequested);
  useFocusEffect(
    useCallback(() => {
      if (!watchAllowed) return undefined;
      let stop: (() => void) | null = null;
      let cancelled = false;
      const start = (): void => {
        watchPickupFix(receiveFix, () => {
          dispatchLocation({ type: 'FIX_RESULT', result: 'unavailable' });
        }).then(
          (remove) => {
            if (cancelled) remove();
            else stop = remove;
          },
          () => {
            dispatchLocation({ type: 'FIX_RESULT', result: 'unavailable' });
          },
        );
      };
      start();
      const subscription = AppState.addEventListener('change', (next) => {
        if (next !== 'active') {
          stop?.();
          stop = null;
        } else if (stop === null) start();
      });
      return () => {
        cancelled = true;
        subscription.remove();
        stop?.();
      };
    }, [watchAllowed, receiveFix, dispatchLocation]),
  );

  // Reverse geocode of the precise fix (debounced; in Lite only after "Find the address").
  const reverseDelay = policy.tuning.reverseDebounceMs;
  const fixLat = fix?.lat ?? null;
  const fixLng = fix?.lng ?? null;
  useEffect(() => {
    if (fixLat === null || fixLng === null || (lite.enabled && !lookupRequested)) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setReverse({ kind: 'loading' });
      flow.api.reverse({ lat: fixLat, lng: fixLng }, locale).then(
        (result) => {
          if (active) setReverse({ kind: 'done', result });
        },
        () => {
          if (active) setReverse({ kind: 'failed' });
        },
      );
    }, reverseDelay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fixLat, fixLng, lite.enabled, lookupRequested, reverseDelay, flow.api, locale]);

  const view = pinView(location, lite.enabled && !lookupRequested && fix !== null ? { kind: 'idle' } : reverse);
  const searchInstead = (
    <Button
      variant="secondary"
      label={t('rider.pin.searchInstead')}
      onPress={() => {
        router.replace({ pathname: '/ride/search', params: { field: 'pickup' } });
      }}
    />
  );
  const settings = (
    <Button
      variant="secondary"
      label={t('rider.location.openSettings')}
      onPress={() => {
        void Linking.openSettings();
      }}
    />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rider.pin.title') }} />
      <Heading>{t('rider.pin.heading')}</Heading>
      {(() => {
        switch (view.kind) {
          case 'start':
            return <Button label={t('rider.location.useCurrent')} onPress={tapUseCurrent} />;
          case 'waiting':
            return <Body muted>{t('rider.location.waiting')}</Body>;
          case 'locating':
            return <Banner tone="info" text={t('rider.location.locating')} />;
          case 'resolving':
            return lite.enabled && !lookupRequested ? (
              <Button
                label={t('rider.pin.findAddress')}
                onPress={() => {
                  setLookupRequested(true);
                }}
              />
            ) : (
              <Banner tone="info" text={t('rider.pin.findingAddress')} />
            );
          case 'confirm': {
            const primary = view.primary ?? t('rider.place.pinned');
            return (
              <>
                <Card label={`${t('rider.pin.isThisPickup')} ${primary}`}>
                  <Body>{t('rider.pin.isThisPickup')}</Body>
                  <Heading>{primary}</Heading>
                  {view.secondary === null ? null : <Body muted>{view.secondary}</Body>}
                </Card>
                {view.addressUnavailable ? <Body muted>{t('rider.pin.addressUnavailable')}</Body> : null}
                {view.outsideArea ? <Banner tone="warning" text={t('rider.pin.outsideArea')} /> : null}
                <Button
                  label={t('rider.pin.useThisPoint')}
                  onPress={() => {
                    if (fix === null) return;
                    flow.dispatchDraft({
                      type: 'SET',
                      field: 'pickup',
                      place: {
                        primary: view.primary,
                        secondary: view.secondary,
                        point: { lat: fix.lat, lng: fix.lng },
                        placeRef: null,
                        source: 'current-location',
                        inServiceArea: reverse.kind === 'done' ? reverse.result.inServiceArea : null,
                      },
                    });
                    router.back();
                  }}
                />
              </>
            );
          }
          case 'approximate':
            return (
              <>
                <Banner tone="info" text={t('rider.location.approximate')} />
                {view.canAskPrecise ? (
                  <Button
                    variant="secondary"
                    label={t('rider.location.usePrecise')}
                    onPress={() => {
                      dispatchLocation({ type: 'TAP_USE_PRECISE' });
                    }}
                  />
                ) : (
                  settings
                )}
              </>
            );
          case 'fix-failed':
            return (
              <>
                <Banner tone="warning" text={t('rider.location.fixFailed')} />
                {view.canRetry ? (
                  <Button
                    label={t('common.retry')}
                    onPress={() => {
                      dispatchLocation({ type: 'RETRY_FIX' });
                    }}
                  />
                ) : null}
              </>
            );
          case 'blocked':
            return (
              <>
                <Banner tone="info" text={t('rider.location.blocked')} />
                {settings}
              </>
            );
          case 'services-off':
            return (
              <>
                <Banner tone="info" text={t('rider.location.servicesOff')} />
                {settings}
              </>
            );
        }
      })()}
      {searchInstead}
      <Body muted>{t('rider.pin.mapLater')}</Body>
    </Screen>
  );
}
