import type { Locale } from '@wayvro/contracts';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Banner, Button, ErrorBanner, RadioGroup, Screen, StateView, TextField, Title } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { buildProfileUpdate, draftFrom, type ProfileDraft, type ProfileValues } from './profile-edit';
import { useLocaleOptions, useUpdateProfile } from './use-update-profile';

export function ProfileScreen() {
  const { t } = useI18n();
  const account = useAccountState();
  const view = viewStateFromQuery(account, (state): ProfileValues => ({
    displayName: state.account.displayName,
    preferredLocale: state.account.preferredLocale,
  }));
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('profile.title') }} />
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
  return <ProfileForm original={view.data} />;
}

function ProfileForm({ original }: { readonly original: ProfileValues }) {
  const { t } = useI18n();
  const update = useUpdateProfile();
  const localeOptions = useLocaleOptions();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(original));
  const [problem, setProblem] = useState<'no-changes' | 'invalid-name' | null>(null);

  const edit = (next: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
    update.reset();
  };
  const save = () => {
    const check = buildProfileUpdate(original, draft);
    if (!check.ok) {
      setProblem(check.reason);
      return;
    }
    update.mutate(check.update);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile.title') }} />
      <Title>{t('profile.title')}</Title>
      <TextField
        label={t('profile.nameLabel')}
        hint={t('profile.nameHelp')}
        value={draft.displayName}
        onChangeText={(displayName) => {
          edit({ displayName });
        }}
        error={problem === 'invalid-name' ? t('profile.nameInvalid') : null}
        maxLength={80}
        autoComplete="name"
        textContentType="name"
        editable={!update.isPending}
      />
      <RadioGroup<Locale>
        label={t('profile.localeLabel')}
        value={draft.preferredLocale}
        options={localeOptions}
        disabled={update.isPending}
        onChange={(preferredLocale) => {
          edit({ preferredLocale });
        }}
      />
      {problem === 'no-changes' ? <Banner tone="info" text={t('profile.noChanges')} /> : null}
      {update.isSuccess ? <Banner tone="info" text={t('profile.saved')} /> : null}
      {update.error === null ? null : <ErrorBanner error={update.error} />}
      <Button label={t('profile.save')} busyLabel={t('common.saving')} busy={update.isPending} onPress={save} />
    </Screen>
  );
}
