import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices, useSessionState, useSignInChallenge } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, Screen, TextField, Title } from '../../../core/ui/primitives';
import type { UiErrorView } from '../../../core/ui/view-state';
import { otpModel, otpResendError, otpVerifyError, sanitizeCode } from './otp-entry';

/**
 * Signed in: hand over to the account gate on a FRESH stack (V08 back-stack rule, SP-08 #5). A plain redirect left the
 * sign-in screens beneath the mode home, so hardware back on that home re-entered sign-in, which redirected straight
 * back to the home and the app could never be left.
 */
function SignedInHandover() {
  const router = useRouter();
  useEffect(() => {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [router]);
  return null;
}

export function OtpEntryScreen() {
  const { client, signInFlow, clock } = useServices();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const challenge = useSignInChallenge();
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<UiErrorView | null>(null);
  const [resent, setResent] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const restart = () => {
    signInFlow.reset();
    router.replace('/sign-in');
  };

  const verify = useMutation({
    mutationFn: (args: { challengeId: string; code: string }) => client.verifyOtp(args.challengeId, args.code),
    // The code is not kept in the mutation cache after the attempt.
    gcTime: 0,
    // The session is persisted before this runs; the signed-in redirect below then hands over to the account gate.
    onSuccess: async () => {
      signInFlow.reset();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
    },
    onError: (e) => {
      const outcome = otpVerifyError(e);
      setError(outcome.view);
      if (outcome.lock) setLocked(true);
      if (outcome.clearCode) setCode('');
    },
  });

  const resend = useMutation({
    mutationFn: (challengeId: string) => client.resendOtp(challengeId),
    onSuccess: (next) => {
      signInFlow.setChallenge(next);
      setLocked(false);
      setError(null);
      setCode('');
      setResent(true);
    },
    onError: (e) => {
      const outcome = otpResendError(e);
      if (outcome.restart) {
        restart();
        return;
      }
      setError(outcome.view);
    },
  });

  if (session.status === 'signed-in') return <SignedInHandover />;
  if (challenge === null) return <Redirect href="/sign-in" />;

  const model = otpModel({
    code,
    challenge,
    deviceNowMs: now,
    serverOffsetMs: clock.offsetMs,
    submitting: verify.isPending,
    resending: resend.isPending,
    locked,
    attempted,
  });
  const submit = () => {
    setAttempted(true);
    if (!model.complete || !model.canSubmit) return;
    setError(null);
    setResent(false);
    verify.mutate({ challengeId: challenge.challengeId, code });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('otp.title') }} />
      <Title>{t('otp.title')}</Title>
      <Body>{t('otp.body', { destination: challenge.maskedDestination })}</Body>
      {resent ? <Banner tone="info" text={t('otp.resent')} /> : null}
      {model.blocked === 'expired' && error === null ? <Banner tone="warning" text={t('otp.expired')} /> : null}
      <TextField
        testID="otp-code"
        label={t('otp.label')}
        value={code}
        onChangeText={(value) => {
          setCode(sanitizeCode(value));
        }}
        error={model.codeErrorKey === null ? null : t(model.codeErrorKey)}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        editable={model.blocked === null && !verify.isPending}
        onSubmitEditing={submit}
        autoFocus
      />
      {error === null ? null : <ErrorBanner error={error} />}
      <Button testID="otp-submit" label={t('otp.submit')} busyLabel={t('otp.verifying')} busy={verify.isPending} disabled={!model.canSubmit} onPress={submit} />
      <Button
        variant="secondary"
        label={model.resendInSeconds > 0 ? t('otp.resendIn', { seconds: model.resendInSeconds }) : t('otp.resend')}
        busyLabel={t('otp.resending')}
        busy={resend.isPending}
        disabled={!model.canResend}
        onPress={() => {
          resend.mutate(challenge.challengeId);
        }}
      />
      <Button variant="secondary" label={t('otp.changeNumber')} disabled={verify.isPending} onPress={restart} />
    </Screen>
  );
}
