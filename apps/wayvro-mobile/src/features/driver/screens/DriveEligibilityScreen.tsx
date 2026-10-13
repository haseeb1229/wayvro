import { Stack } from 'expo-router';
import { useIntentNavigation } from '../../../core/intents/use-intents';
import { Banner, Button, Screen, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { useDriverText } from '../ui/DriverUi';

/**
 * Eligibility per service product `/drive/eligibility` (lazy). In this checkpoint the per-product evaluation does not
 * exist on the server yet, so the screen says exactly that and links to the server's current Driver/Partner status —
 * it never shows invented eligibility results.
 */
export default function DriveEligibilityScreen() {
  const dt = useDriverText();
  const openIntent = useIntentNavigation();
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('drive.eligibility.title') }} />
      <Title>{dt('drive.eligibility.title')}</Title>
      <Banner tone="info" text={dt('drive.eligibility.next')} />
      <Button
        variant="secondary"
        label={dt('drive.eligibility.openStatus')}
        onPress={() => {
          openIntent({ kind: 'OPEN_DRIVER_COMPLIANCE' });
        }}
      />
      <TranslationPendingNote />
    </Screen>
  );
}
