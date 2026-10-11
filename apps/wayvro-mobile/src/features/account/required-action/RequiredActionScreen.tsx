import { Stack } from 'expo-router';
import { primaryRequiredAction } from '../../../core/account/account-route';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Banner, Screen, Title } from '../../../core/ui/primitives';
import { SignOutButton } from '../home/SignOutButton';
import { RecoveryReview } from '../security/RecoveryReview';

/**
 * Restricted-session actions. The dormant-number review (P2.9) is answered here without exposing any data of the
 * earlier account; the phone step-up required action has no self-service flow in this version and says so honestly.
 */
export function RequiredActionScreen() {
  const { t } = useI18n();
  const account = useAccountState();
  const action = account.data ? primaryRequiredAction(account.data.requiredActions) : null;
  if (action === 'RECOVERY_REVIEW') {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('review.title') }} />
        <RecoveryReview />
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: t('required.title') }} />
      <Title>{t('required.title')}</Title>
      {action === 'PHONE_STEP_UP' ? <Banner tone="warning" text={t('required.phoneStepUp')} /> : null}
      <SignOutButton />
    </Screen>
  );
}
