import { Stack } from 'expo-router';
import { primaryRequiredAction } from '../../../core/account/account-route';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Body, Screen, Title } from '../../../core/ui/primitives';
import { SignOutButton } from '../home/SignOutButton';
import { RecoveryReview } from '../security/RecoveryReview';
import { StepUpPanel } from '../security/StepUpPanel';

/**
 * Restricted-session actions. The dormant-number review (P2.9) is answered here without exposing any data of the
 * earlier account. PHONE_STEP_UP (P2.10: an OIDC sign-in on an installation that never signed in with the phone) is
 * answered with the phone step-up; the server lifts the action once the session has stepped up.
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
      {action === 'PHONE_STEP_UP' ? (
        <>
          <Body>{t('required.phoneStepUp')}</Body>
          <StepUpPanel
            onVerified={() => {
              void account.refetch();
            }}
          />
        </>
      ) : null}
      <SignOutButton />
    </Screen>
  );
}
