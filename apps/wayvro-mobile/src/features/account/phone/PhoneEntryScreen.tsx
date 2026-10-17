import { useMutation } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { PHONE_FORMAT_EXAMPLES, type UiLocale } from '../../../core/i18n/strings';
import { useServices, useSessionState, useSignInNotice } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, RadioGroup, Screen, TextField, Title } from '../../../core/ui/primitives';
import { FullyDrawnMarker } from '../../../platform/perf/fully-drawn';
import { useLocaleOptions } from '../profile/use-update-profile';
import { checkPhone, phoneFormModel, phoneRequestError } from './phone-entry';

export function PhoneEntryScreen() {
  const { client, signInFlow, setUiLocale } = useServices();
  const { t, locale } = useI18n();
  const session = useSessionState();
  const notice = useSignInNotice();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);
  const localeOptions = useLocaleOptions();
  const request = useMutation({
    mutationFn: (normalised: string) => client.requestOtp(normalised, locale),
    // The phone number is not kept in the mutation cache after the attempt.
    gcTime: 0,
    onSuccess: (challenge) => {
      signInFlow.setChallenge(challenge);
      signInFlow.setNotice(null);
      router.push('/sign-in/verify');
    },
  });

  if (session.status === 'signed-in') return <Redirect href="/" />;

  const model = phoneFormModel(phone, request.isPending, attempted);
  const submit = () => {
    setAttempted(true);
    const check = checkPhone(phone);
    if (check.ok) request.mutate(check.phone);
  };
  const statusBanner =
    session.status === 'signed-out' && session.reason === 'expired'
      ? t('phone.sessionEnded')
      : session.status === 'signed-out' && session.reason === 'signed-out'
        ? t(notice === 'signed-out-local-only' ? 'phone.signedOutLocalOnly' : 'phone.signedOut')
        : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('appName') }} />
      <Title>{t('phone.title')}</Title>
      {statusBanner === null ? null : <Banner tone="info" text={statusBanner} />}
      <Body>{t('phone.body')}</Body>
      {/* SP-02 §6.1: the signed-out first screen is interactive once rendered (PB-02). */}
      <FullyDrawnMarker />
      <TextField
        testID="phone-number"
        label={t('phone.label')}
        hint={t('phone.hint', PHONE_FORMAT_EXAMPLES)}
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          request.reset();
        }}
        error={model.inputErrorKey === null ? null : t(model.inputErrorKey)}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={20}
        editable={!request.isPending}
        onSubmitEditing={submit}
      />
      {request.isError ? <ErrorBanner error={phoneRequestError(request.error)} /> : null}
      <Button
        testID="phone-submit"
        label={t('phone.submit')}
        busyLabel={t('phone.sending')}
        busy={request.isPending}
        disabled={!model.canSubmit}
        onPress={submit}
      />
      <Body muted>{t('phone.legalNote')}</Body>
      <RadioGroup<UiLocale>
        label={t('language.label')}
        value={locale}
        disabled={request.isPending}
        options={localeOptions}
        onChange={(next) => {
          void setUiLocale(next);
        }}
      />
    </Screen>
  );
}
