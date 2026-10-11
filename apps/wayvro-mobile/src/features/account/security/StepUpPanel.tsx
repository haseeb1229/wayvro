import type { OtpChallenge } from '@wayvro/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, Heading, TextField } from '../../../core/ui/primitives';
import { colors, spacing } from '../../../core/ui/tokens';
import type { UiErrorView } from '../../../core/ui/view-state';
import { otpModel, otpVerifyError, sanitizeCode } from '../otp/otp-entry';
import { guardedErrorView, stepUpSendError } from './account-security';
import { useAccountSecurityApi, type GuardedAction } from './use-account-security';

/**
 * Step-up (fresh code on the CURRENT phone) for a guarded action, then an explicit "Continue" before the action is
 * retried. Shown only after the server asked for it; the server decides how long the confirmation lasts.
 */
export function GuardedActionPanel({ action, showFailure = true }: { readonly action: GuardedAction; readonly showFailure?: boolean }) {
  const { t } = useI18n();
  const { phase } = action;
  if (phase.kind === 'step-up') return <StepUpPanel onVerified={action.steppedUp} onCancel={action.cancel} />;
  if (phase.kind === 'confirm-retry') {
    return (
      <View style={styles.card}>
        <Heading>{t('stepUp.confirmedTitle')}</Heading>
        <Body>{t('stepUp.confirmedBody')}</Body>
        <Button label={t('stepUp.continue')} onPress={action.confirm} />
        <Button variant="secondary" label={t('common.cancel')} onPress={action.cancel} />
      </View>
    );
  }
  if (phase.kind === 'failed' && showFailure) return <ErrorBanner error={guardedErrorView(phase)} />;
  return null;
}

function StepUpPanel({ onVerified, onCancel }: { readonly onVerified: () => void; readonly onCancel: () => void }) {
  const { t } = useI18n();
  const { clock } = useServices();
  const api = useAccountSecurityApi();
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<UiErrorView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const send = useMutation({
    mutationFn: () => api.startStepUp(),
    onSuccess: (next) => {
      setChallenge(next);
      setCode('');
      setLocked(false);
      setError(null);
    },
    onError: (e) => {
      setError(stepUpSendError(e));
    },
  });
  const verify = useMutation({
    mutationFn: (args: { challengeId: string; code: string }) => api.verifyStepUp(args.challengeId, args.code),
    gcTime: 0,
    onSuccess: onVerified,
    onError: (e) => {
      const outcome = otpVerifyError(e);
      setError(outcome.view);
      if (outcome.lock) setLocked(true);
      if (outcome.clearCode) setCode('');
    },
  });

  const model =
    challenge === null
      ? null
      : otpModel({
          code,
          challenge,
          deviceNowMs: now,
          serverOffsetMs: clock.offsetMs,
          submitting: verify.isPending,
          resending: send.isPending,
          locked,
          attempted,
        });
  const submit = () => {
    setAttempted(true);
    if (challenge === null || model === null || !model.complete || !model.canSubmit) return;
    setError(null);
    verify.mutate({ challengeId: challenge.challengeId, code });
  };

  return (
    <View style={styles.card}>
      <Heading>{t('stepUp.title')}</Heading>
      {challenge === null || model === null ? (
        <>
          <Body>{t('stepUp.body')}</Body>
          {error === null ? null : <ErrorBanner error={error} />}
          <Button
            label={t('stepUp.send')}
            busyLabel={t('stepUp.sending')}
            busy={send.isPending}
            onPress={() => {
              send.mutate();
            }}
          />
        </>
      ) : (
        <>
          <Body>{t('stepUp.sent', { destination: challenge.maskedDestination })}</Body>
          {model.blocked === 'expired' && error === null ? <Banner tone="warning" text={t('otp.expired')} /> : null}
          <TextField
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
          />
          {error === null ? null : <ErrorBanner error={error} />}
          <Button label={t('stepUp.verify')} busyLabel={t('stepUp.verifying')} busy={verify.isPending} disabled={!model.canSubmit} onPress={submit} />
          <Button
            variant="secondary"
            label={model.resendInSeconds > 0 ? t('otp.resendIn', { seconds: model.resendInSeconds }) : t('stepUp.newCode')}
            busy={send.isPending}
            disabled={!model.canResend}
            onPress={() => {
              send.mutate();
            }}
          />
        </>
      )}
      <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
});
