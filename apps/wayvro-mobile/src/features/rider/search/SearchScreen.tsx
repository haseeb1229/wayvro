import { useMutation } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import type { UiLocale } from '../../../core/i18n/strings';
import { searchTuning } from '../../../core/lite/lite-mode';
import { useLiteMode } from '../../../core/lite/use-lite';
import { useAppPolicy } from '../../../core/release/AppPolicyGate';
import { useServices } from '../../../core/services/ServicesProvider';
import { PlaceRow, StaleIndicator } from '../../../core/ui/components';
import { Banner, Body, Button, ErrorBanner, LinkRow, Screen, TextField } from '../../../core/ui/primitives';
import { errorView } from '../../../core/ui/view-state';
import { pointPrecision } from '../../../platform/location/fix-policy';
import type { DraftField, DraftPlace } from '../flow/draft';
import { useRiderFlow } from '../flow/RiderFlowProvider';
import { startCurrentLocation } from '../location/start-location';
import { placeLine } from '../quote/quote-view';
import { SearchController, type SearchState, type SearchTuning, type Suggestion } from './search-controller';
import { searchFieldParam, suggestionLabel } from './search-view';

/**
 * Where-to search `/ride/search` (B02; UX doc §8.2): Pickup and Drop-off fields, server suggestions (at most one request
 * in flight), session recents (memory only), "Use current location" (pickup) and "type the full address". The opaque
 * placeRef is resolved by the server on selection; nothing is transliterated or geocoded on the phone.
 */
export function SearchScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { newUuid } = useServices();
  const flow = useRiderFlow();
  const lite = useLiteMode();
  const policy = useAppPolicy();
  const [field, setField] = useState<DraftField>(() => searchFieldParam(params['field']));
  const [texts, setTexts] = useState<Readonly<Record<DraftField, string>>>({ pickup: '', dropoff: '' });
  const [sessions, setSessions] = useState<Readonly<Record<DraftField, string>>>(() => ({ pickup: newUuid(), dropoff: newUuid() }));

  const tuning = searchTuning(lite.enabled, { minChars: policy.tuning.autocompleteMinChars, debounceMs: policy.tuning.autocompleteDebounceMs });
  // The context of each search call: tuning (Lite-aware), the field's provider session, the 2-decimal bias, the locale.
  const contextFor = (f: DraftField): SearchContext => ({ ...tuning, session: sessions[f], bias: flow.bias, locale });
  const { api } = flow;
  const [controller] = useState(
    () =>
      new SearchController<SearchContext>({
        autocomplete: (q, mode, signal, c) => api.autocomplete({ q, mode, signal, session: c.session, bias: c.bias, locale: c.locale }),
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (handle) => {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
      }),
  );
  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );
  const search = useSyncExternalStore(controller.subscribe, controller.getState);

  const choose = (place: DraftPlace): void => {
    flow.dispatchDraft({ type: 'SET', field, place });
    flow.rememberRecent(place);
    const other: DraftField = field === 'pickup' ? 'dropoff' : 'pickup';
    const otherSet = (other === 'pickup' ? flow.draft.pickup : flow.draft.dropoff) !== null;
    // A completed session ends the provider billing session of this field.
    setSessions((current) => ({ ...current, [field]: newUuid() }));
    if (otherSet) {
      router.push('/ride/quote');
      return;
    }
    setField(other);
    controller.setQuery(texts[other], contextFor(other));
  };

  const resolve = useMutation({
    mutationFn: (suggestion: Suggestion) => flow.api.resolvePlace(suggestion.placeRef, sessions[field], locale),
    onSuccess: (resolved, suggestion) => {
      choose({
        primary: resolved.primaryText,
        secondary: resolved.secondaryText,
        point: pointPrecision(resolved.point),
        placeRef: suggestion.placeRef,
        source: 'search',
        inServiceArea: resolved.inServiceArea,
      });
    },
  });

  const onChange = (value: string): void => {
    setTexts((current) => ({ ...current, [field]: value }));
    controller.setQuery(value, contextFor(field));
  };
  const focus = (next: DraftField): void => {
    if (next === field) return;
    setField(next);
    controller.setQuery(texts[next], contextFor(next));
  };
  const current = (f: DraftField): string | null => placeLine(t, f === 'pickup' ? flow.draft.pickup : flow.draft.dropoff);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rider.search.title') }} />
      <TextField
        testID="search-pickup"
        label={t('rider.search.pickup')}
        value={texts.pickup}
        onChangeText={field === 'pickup' ? onChange : noop}
        onFocus={() => {
          focus('pickup');
        }}
        autoFocus={field === 'pickup'}
        maxLength={80}
        {...hintFor(current('pickup'))}
      />
      <TextField
        testID="search-dropoff"
        label={t('rider.search.dropoff')}
        value={texts.dropoff}
        onChangeText={field === 'dropoff' ? onChange : noop}
        onFocus={() => {
          focus('dropoff');
        }}
        autoFocus={field === 'dropoff'}
        maxLength={80}
        {...hintFor(current('dropoff'))}
      />
      <Body muted>{t('rider.search.hint')}</Body>
      <Body muted>{t('rider.search.languageHint')}</Body>
      {resolve.error === null ? null : <ErrorBanner error={errorView(resolve.error)} />}
      <SearchBody
        state={search}
        busy={resolve.isPending}
        minChars={tuning.minChars}
        onPick={(s) => {
          resolve.mutate(s);
        }}
        onRetry={() => {
          controller.retry(contextFor(field));
        }}
        onFullAddress={() => {
          controller.searchFullAddress(contextFor(field));
        }}
      />
      {search.query.trim() === '' ? (
        <View>
          {flow.recents.map((place) => (
            <PlaceRow
              key={`${place.primary ?? ''}|${place.secondary ?? ''}`}
              glyph="↺"
              primary={placeLine(t, place) ?? ''}
              secondary={place.secondary}
              label={t('rider.search.recentLabel', { place: suggestionLabel(placeLine(t, place) ?? '', place.secondary) })}
              onPress={() => {
                choose({ ...place, placeRef: null });
              }}
            />
          ))}
        </View>
      ) : null}
      {field === 'pickup' ? (
        <LinkRow
          label={t('rider.location.useCurrent')}
          detail={t('rider.search.pinHint')}
          onPress={() => {
            router.push(startCurrentLocation(flow.location, flow.dispatchLocation));
          }}
        />
      ) : null}
    </Screen>
  );
}

interface SearchContext extends SearchTuning {
  readonly session: string;
  readonly bias: { readonly lat: number; readonly lng: number } | null;
  readonly locale: UiLocale;
}

const noop = (): void => undefined;
const hintFor = (value: string | null): { readonly hint?: string } => (value === null ? {} : { hint: value });

function SearchBody(props: {
  readonly state: SearchState;
  readonly busy: boolean;
  readonly minChars: number;
  readonly onPick: (s: Suggestion) => void;
  readonly onRetry: () => void;
  readonly onFullAddress: () => void;
}) {
  const { t } = useI18n();
  const { state } = props;
  switch (state.status) {
    case 'idle':
      return null;
    case 'too-short':
      return <Body muted>{t('rider.search.tooShort', { count: props.minChars })}</Body>;
    case 'waiting':
    case 'loading':
      return <Banner tone="info" text={t('rider.search.searching')} />;
    case 'empty':
      return (
        <>
          <Banner tone="info" text={t('rider.search.noResults')} />
          <Button variant="secondary" label={t('rider.search.fullAddress')} onPress={props.onFullAddress} />
        </>
      );
    case 'offline':
      return (
        <>
          <Banner tone="offline" text={t('rider.search.offline')} />
          <Button label={t('common.retry')} onPress={props.onRetry} />
        </>
      );
    case 'degraded':
      return (
        <>
          <Banner tone="warning" text={t('rider.search.degraded')} />
          <Button variant="secondary" label={t('rider.search.fullAddress')} onPress={props.onFullAddress} />
          <Button variant="secondary" label={t('common.retry')} onPress={props.onRetry} />
        </>
      );
    case 'error':
      return (
        <>
          <Banner tone="error" text={t('rider.search.error')} />
          <Button label={t('common.retry')} onPress={props.onRetry} />
        </>
      );
    case 'results':
      return (
        <View>
          <Banner tone="info" text={t('rider.search.count', { count: state.suggestions.length })} announce="search-results" />
          {state.stale ? <StaleIndicator text={t('rider.search.stale')} /> : null}
          {state.suggestions.map((s) => (
            <PlaceRow
              key={s.placeRef}
              glyph={s.kind === 'LANDMARK' ? '★' : '•'}
              primary={s.primaryText}
              secondary={s.secondaryText}
              label={suggestionLabel(s.primaryText, s.secondaryText)}
              disabled={props.busy}
              onPress={() => {
                props.onPick(s);
              }}
            />
          ))}
        </View>
      );
  }
}
