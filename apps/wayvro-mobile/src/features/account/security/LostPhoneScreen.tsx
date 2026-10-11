import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Banner, Body, Button, ErrorBanner, RadioGroup, Screen, TextField, Title } from '../../../core/ui/primitives';
import { errorView } from '../../../core/ui/view-state';
import type { RecoveryProof } from './account-security-api';
import { AVAILABLE_PROOFS, buildRecoveryRequest } from './account-security';
import { useAccountSecurityApi } from './use-account-security';

/**
 * "I lost my old number" (K08/S12): a request to move an older account to this number, with strong proof only. The
 * answer is always RECEIVED and the guidance is the same for everyone, so nothing reveals whether the old number had
 * an account or what kind.
 */
export default function LostPhoneScreen() {
  const { t } = useI18n();
  const api = useAccountSecurityApi();
  const [previous, setPrevious] = useState('');
  const [proof, setProof] = useState<RecoveryProof>('DRIVER_KYC');
  const [inputError, setInputError] = useState<'phone.invalid' | 'lostPhone.proofUnavailable' | null>(null);
  const send = useMutation({ mutationFn: (args: { previousPhone: string; proof: RecoveryProof }) => api.requestRecovery(args.previousPhone, args.proof) });

  if (send.isSuccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('lostPhone.title') }} />
        <Title>{t('lostPhone.title')}</Title>
        <Banner tone="info" text={t('lostPhone.received')} />
        <Body>{t('lostPhone.guidance')}</Body>
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: t('lostPhone.title') }} />
      <Title>{t('lostPhone.title')}</Title>
      <Body>{t('lostPhone.body')}</Body>
      <TextField
        label={t('lostPhone.previousLabel')}
        hint={t('phone.hint')}
        value={previous}
        onChangeText={(value) => {
          setPrevious(value);
          setInputError(null);
        }}
        keyboardType="phone-pad"
        maxLength={40}
        error={inputError === 'phone.invalid' ? t(inputError) : null}
      />
      <RadioGroup<RecoveryProof>
        label={t('lostPhone.proofLabel')}
        value={proof}
        options={(['DRIVER_KYC', 'LINKED_OIDC'] as const).map((value) => ({ value, label: t(`lostPhone.proof.${value}`) }))}
        onChange={(next) => {
          // Linked sign-in accounts arrive in a later version: shown, but not selectable.
          if (AVAILABLE_PROOFS.has(next)) setProof(next);
          else setInputError('lostPhone.proofUnavailable');
        }}
      />
      {inputError === 'lostPhone.proofUnavailable' ? <Banner tone="info" text={t(inputError)} /> : null}
      <Body muted>{t('lostPhone.guidance')}</Body>
      {send.error === null ? null : <ErrorBanner error={errorView(send.error)} />}
      <Button
        label={t('lostPhone.submit')}
        busyLabel={t('lostPhone.sending')}
        busy={send.isPending}
        onPress={() => {
          const built = buildRecoveryRequest(previous, proof);
          if (!built.ok) {
            setInputError(built.errorKey);
            return;
          }
          send.mutate({ previousPhone: built.previousPhone, proof: built.proof });
        }}
      />
    </Screen>
  );
}
