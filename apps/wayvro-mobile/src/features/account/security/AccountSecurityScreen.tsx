import { Stack, useRouter } from 'expo-router';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Body, LinkRow, Screen, Title } from '../../../core/ui/primitives';
import { PhoneChangeNotice } from './PhoneChangeNotice';

/** Phone number and account (P2.9): change number, lost-phone recovery request, deletion, security activity. */
export default function AccountSecurityScreen() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('accountSecurity.title') }} />
      <Title>{t('accountSecurity.title')}</Title>
      <Body muted>{t('accountSecurity.body')}</Body>
      <PhoneChangeNotice />
      <LinkRow
        label={t('accountSecurity.changePhone')}
        onPress={() => {
          router.push('/account/phone');
        }}
      />
      <LinkRow
        label={t('accountSecurity.lostPhone')}
        detail={t('accountSecurity.lostPhoneHint')}
        onPress={() => {
          router.push('/account/recovery');
        }}
      />
      <LinkRow
        label={t('security.title')}
        onPress={() => {
          router.push('/security');
        }}
      />
      <LinkRow
        label={t('accountSecurity.delete')}
        onPress={() => {
          router.push('/account/delete');
        }}
      />
    </Screen>
  );
}
