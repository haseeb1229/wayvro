import type { PhoneChangeStarted } from './account-security-api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDateTime } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, Screen, TextField, Title } from '../../../core/ui/primitives';
import type { UiErrorView } from '../../../core/ui/view-state';
import { otpModel, otpVerifyError, sanitizeCode } from '../otp/otp-entry';
import { buildPhoneChange, phoneChangeRefusal } from './account-security';
import { GuardedActionPanel } from './StepUpPanel';
import { SECURITY_KEYS, useAccountSecurityApi, useGuardedAction } from './use-account-security';

/**
 * Phone number change (A05/K08): new number (format check on device only) → code to the NEW number → change. Every
 * refusal except the new-device cooldown is generic. On success the server signed out the other devices; the account
 * state and security activity are re-read.
 */
export default function PhoneChangeScreen() {
  const { t, locale } = useI18n();
  const { clock } = useServices();
  const api = useAccountSecurityApi();
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState('');
  const [inputError, setInputError] = useState<'phone.invalid' | null>(null);
  const [started, setStarted] = useState<PhoneChangeStarted | null>(null);
  const [refusal, setRefusal] = useState<ReturnType<typeof phoneChangeRefusal> | null>(null);
  const [done, setDone] = useState(false);

  const run = useCallback(() => {
    const built = buildPhoneChange(raw);
    if (!built.ok) return Promise.reject(new Error('invalid-phone'));
    return api.startPhoneChange(built.newPhone, locale);
  }, [api, raw, locale]);
  const onStarted = useCallback((result: PhoneChangeStarted) => {
    setStarted(result);
    setRefusal(null);
  }, []);
  const onRefused = useCallback(
    (error: unknown) => {
      setRefusal(phoneChangeRefusal(error, Date.now(), clock.offsetMs));
    },
    [clock],
  );
  const action = useGuardedAction(run, onStarted, onRefused);

  const finish = async () => {
    setDone(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessions }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.securityEvents }),
      queryClient.invalidateQueries({ queryKey: SECURITY_KEYS.phoneChange }),
    ]);
  };

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('phoneChange.title') }} />
        <Title>{t('phoneChange.title')}</Title>
        <Banner tone="info" text={t('phoneChange.done')} />
      </Screen>
    );
  }
  if (started !== null) {
    return (
      <VerifyNewNumber
        started={started}
        onDone={() => {
          void finish();
        }}
        onRestart={() => {
          setStarted(null);
          action.cancel();
        }}
      />
    );
  }

  const busy = action.phase.kind === 'running';
  const refusalBanner =
    refusal === null || action.phase.kind !== 'failed' ? null : refusal.kind === 'cooldown' ? (
      <Banner
        tone="warning"
        text={refusal.availableAt === null ? t('phoneChange.cooldownNoTime') : t('phoneChange.cooldown', { date: formatDateTime(refusal.availableAt, locale) })}
      />
    ) : refusal.kind === 'message' ? (
      <ErrorBanner error={refusal.view} />
    ) : null;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('phoneChange.title') }} />
      <Title>{t('phoneChange.title')}</Title>
      <Body>{t('phoneChange.body')}</Body>
      <TextField
        label={t('phoneChange.label')}
        hint={t('phone.hint')}
        value={raw}
        onChangeText={(value) => {
          setRaw(value);
          setInputError(null);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={40}
        editable={!busy && action.phase.kind !== 'step-up' && action.phase.kind !== 'confirm-retry'}
        error={inputError === null ? null : t(inputError)}
      />
      {refusalBanner}
      <GuardedActionPanel action={action} showFailure={false} />
      {action.phase.kind === 'step-up' || action.phase.kind === 'confirm-retry' ? null : (
        <Button
          label={t('phoneChange.submit')}
          busyLabel={t('stepUp.sending')}
          busy={busy}
          onPress={() => {
            const built = buildPhoneChange(raw);
            if (!built.ok) {
              setInputError(built.errorKey);
              return;
            }
            setRefusal(null);
            action.start();
          }}
        />
      )}
    </Screen>
  );
}

function VerifyNewNumber(props: { readonly started: PhoneChangeStarted; readonly onDone: () => void; readonly onRestart: () => void }) {
  const { t } = useI18n();
  const { clock } = useServices();
  const api = useAccountSecurityApi();
  const { challenge, phoneChange } = props.started;
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

  const verify = useMutation({
    mutationFn: (value: string) => api.verifyPhoneChange(phoneChange.id, challenge.challengeId, value),
    gcTime: 0,
    onSuccess: props.onDone,
    onError: (e) => {
      const otp = otpVerifyError(e);
      if (otp.view.messageKey === 'otp.locked' || otp.view.messageKey === 'otp.invalidOrExpired') {
        setError(otp.view);
        if (otp.lock) setLocked(true);
        setCode('');
        return;
      }
      // Any other refusal (409 included) is generic: it never says why the number could not be used.
      const refusal = phoneChangeRefusal(e, Date.now(), clock.offsetMs);
      setError(refusal.kind === 'message' ? refusal.view : { kind: 'conflict', messageKey: 'phoneChange.generic', action: 'none' });
    },
  });
  const model = otpModel({
    code,
    challenge,
    deviceNowMs: now,
    serverOffsetMs: clock.offsetMs,
    submitting: verify.isPending,
    resending: false,
    locked,
    attempted,
  });
  const submit = () => {
    setAttempted(true);
    if (!model.complete || !model.canSubmit) return;
    setError(null);
    verify.mutate(code);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('phoneChange.title') }} />
      <Title>{t('phoneChange.title')}</Title>
      <Body>{t('phoneChange.codeBody', { destination: challenge.maskedDestination })}</Body>
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
        autoFocus
      />
      {error === null ? null : <ErrorBanner error={error} />}
      <Button label={t('phoneChange.verify')} busyLabel={t('phoneChange.verifying')} busy={verify.isPending} disabled={!model.canSubmit} onPress={submit} />
      <Button variant="secondary" label={t('phoneChange.startOver')} disabled={verify.isPending} onPress={props.onRestart} />
    </Screen>
  );
}
