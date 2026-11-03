import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useServerNow } from '../../../core/api/use-server-now';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { FareBreakdown, StaleIndicator } from '../../../core/ui/components';
import { Banner, Body, Button, Heading, Screen, Title } from '../../../core/ui/primitives';
import { useRiderFlow } from '../flow/RiderFlowProvider';
import { fareView } from './fare-view';

/**
 * Fare breakdown `/ride/fare` (B04 display; UX doc §8.5): the server's components exactly as sent, total last, with the
 * rate-card reference for support. It shows the quote group held in memory by the rider flow (no extra call); after a
 * restart that group is gone and the screen says so instead of showing anything invented.
 */
export function FareScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { group } = useRiderFlow();
  const serverNow = useServerNow(1000);
  const quoteId = typeof params['quote'] === 'string' ? params['quote'] : null;
  const option = group?.options.find((o) => o.quoteId === quoteId) ?? null;

  if (option === null) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('fare.title') }} />
        <Title>{t('fare.title')}</Title>
        <Banner tone="info" text={t('rider.quote.notFoundBody')} />
        <Button
          variant="secondary"
          label={t('fare.back')}
          onPress={() => {
            router.back();
          }}
        />
      </Screen>
    );
  }
  const view = fareView(t, option, serverNow);
  return (
    <Screen>
      <Stack.Screen options={{ title: t('fare.title') }} />
      <Title>{t('fare.title')}</Title>
      <Heading>{view.title}</Heading>
      {view.expired ? (
        <>
          <Banner tone="warning" text={t('rider.quote.pricesUpdated')} announce="expiry" />
          <StaleIndicator text={t('fare.expiredNote')} />
          <Button
            label={t('rider.quote.getNewPrice')}
            onPress={() => {
              router.back();
            }}
          />
        </>
      ) : null}
      <FareBreakdown rows={view.rows} total={view.total} />
      {view.notes.map((note) => (
        <Body key={note} muted>
          {note}
        </Body>
      ))}
      <Body muted>{view.reference}</Body>
    </Screen>
  );
}
