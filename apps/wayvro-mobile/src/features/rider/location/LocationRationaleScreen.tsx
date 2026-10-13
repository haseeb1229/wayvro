import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Section } from '../../../core/ui/components';
import { Body, Button, Screen, Title } from '../../../core/ui/primitives';
import { useRiderFlow } from '../flow/RiderFlowProvider';

/**
 * Location rationale `/ride/location` (A07, V05; permission doc §4.2 RATIONALE): why, when, what is sent, that nothing
 * is stored on the phone, and the alternatives — BEFORE any OS dialog. Continue moves the machine to REQUESTING (the OS
 * dialog) and this screen is REPLACED by the pin screen, so back never re-opens the dialog. Leaving any other way
 * (Not now, hardware back) counts as "Not now".
 */
export function LocationRationaleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { dispatchLocation } = useRiderFlow();
  const fromPin = params['from'] === 'pin';

  // Hardware back / unmount while still deciding = "Not now" (ignored by the machine after Continue).
  useEffect(
    () => () => {
      dispatchLocation({ type: 'RATIONALE_NOT_NOW' });
    },
    [dispatchLocation],
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rider.location.title') }} />
      <Title>{t('rider.location.title')}</Title>
      <Section title={t('rider.location.whyTitle')}>
        <Body>{t('rider.location.why')}</Body>
      </Section>
      <Section title={t('rider.location.whenTitle')}>
        <Body>{t('rider.location.when')}</Body>
      </Section>
      <Section title={t('rider.location.sentTitle')}>
        <Body>{t('rider.location.sent')}</Body>
      </Section>
      <Section title={t('rider.location.alternativesTitle')}>
        <Body>{t('rider.location.alternatives')}</Body>
      </Section>
      <Button
        label={t('common.continue')}
        onPress={() => {
          dispatchLocation({ type: 'RATIONALE_CONTINUE' });
          if (fromPin) router.back();
          else router.replace('/ride/pin');
        }}
      />
      <Button
        variant="secondary"
        label={t('common.notNow')}
        onPress={() => {
          dispatchLocation({ type: 'RATIONALE_NOT_NOW' });
          router.back();
        }}
      />
    </Screen>
  );
}
