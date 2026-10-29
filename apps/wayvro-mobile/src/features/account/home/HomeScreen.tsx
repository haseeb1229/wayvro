import { Stack, useRouter } from 'expo-router';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { LiteToggle } from '../../../core/lite/use-lite';
import { Banner, Body, Button, ErrorBanner, LinkRow, RadioGroup, Screen, StateView, Title } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { useLocaleOptions, useUpdateProfile } from '../profile/use-update-profile';
import { PhoneChangeNotice } from '../security/PhoneChangeNotice';
import { RestrictionNotices } from './RestrictionNotices';
import { SignOutButton } from './SignOutButton';
import { homeModel } from './home';

export function HomeScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const account = useAccountState();
  const update = useUpdateProfile();
  const localeOptions = useLocaleOptions();
  const view = viewStateFromQuery(account, homeModel);

  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('home.title') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void account.refetch();
          }}
        />
      </Screen>
    );
  }
  const home = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('home.title') }} />
      <Title>{home.name === null ? t('home.greetingNoName') : t('home.greeting', { name: home.name })}</Title>
      <Body muted>{t('home.memberSince', { date: formatDate(home.memberSince, locale) })}</Body>
      {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      {home.deletionPending ? (
        <>
          <Banner tone="warning" text={t('deletion.pendingBanner')} />
          <Button
            variant="secondary"
            label={t('deletion.pendingOpen')}
            onPress={() => {
              router.push('/account/delete');
            }}
          />
        </>
      ) : null}
      <PhoneChangeNotice />
      <RestrictionNotices items={home.restrictions} />
      <LinkRow
        label={t('home.rides')}
        detail={t('home.ridesHint')}
        onPress={() => {
          router.push('/ride');
        }}
      />
      {home.driverEntry === null ? null : (
        <LinkRow
          label={t(home.driverEntry === 'apply' ? 'home.earn' : 'home.driverArea')}
          detail={t(home.driverEntry === 'apply' ? 'home.earnHint' : 'home.driverAreaHint')}
          onPress={() => {
            router.push('/earn');
          }}
        />
      )}
      <LinkRow
        label={t('profile.title')}
        onPress={() => {
          router.push('/profile');
        }}
      />
      <LinkRow
        label={t('sessions.title')}
        onPress={() => {
          router.push('/sessions');
        }}
      />
      <LinkRow
        label={t('accountSecurity.title')}
        onPress={() => {
          router.push('/account');
        }}
      />
      <LinkRow
        label={t('security.title')}
        onPress={() => {
          router.push('/security');
        }}
      />
      <LinkRow
        label={t('legal.title')}
        onPress={() => {
          router.push('/legal');
        }}
      />
      <RadioGroup
        label={t('language.label')}
        value={home.preferredLocale}
        disabled={update.isPending}
        options={localeOptions}
        onChange={(preferredLocale) => {
          update.mutate({ preferredLocale });
        }}
      />
      {update.error === null ? null : <ErrorBanner error={update.error} />}
      <LiteToggle />
      <SignOutButton />
    </Screen>
  );
}
