import { Stack } from 'expo-router';
import { primaryRequiredAction } from '../../../core/account/account-route';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Banner, Screen, Title } from '../../../core/ui/primitives';
import { SignOutButton } from '../home/SignOutButton';

/**
 * Restricted-session actions whose flows ship in later micro-phases (phone step-up, recovery review — P2.9). The
 * screen says honestly that the step is not available yet; nothing else of the account is exposed.
 */
export function RequiredActionScreen() {
  const { t } = useI18n();
  const account = useAccountState();
  const action = account.data ? primaryRequiredAction(account.data.requiredActions) : null;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('required.title') }} />
      <Title>{t('required.title')}</Title>
      {action === 'RECOVERY_REVIEW' ? <Banner tone="warning" text={t('required.recoveryReview')} /> : null}
      {action === 'PHONE_STEP_UP' ? <Banner tone="warning" text={t('required.phoneStepUp')} /> : null}
      <SignOutButton />
    </Screen>
  );
}
