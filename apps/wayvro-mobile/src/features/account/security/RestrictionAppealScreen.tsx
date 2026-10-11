import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { z } from 'zod';
import { APPEAL_MAX, buildAppeal, type AppealRequest } from '../../../core/account/appeal';
import { toApiError } from '../../../core/api/errors';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, Screen, TextField, Title } from '../../../core/ui/primitives';
import { errorView } from '../../../core/ui/view-state';

/** Rider-side appeal of an appealable restriction (V13, K05): the account holder's own words; a person decides. */
const ParamsSchema = z.object({ restriction: z.uuid() });

export default function RestrictionAppealScreen() {
  const { t } = useI18n();
  const { client } = useServices();
  const queryClient = useQueryClient();
  const params = ParamsSchema.safeParse(useLocalSearchParams());
  const [statement, setStatement] = useState('');
  const [invalid, setInvalid] = useState(false);
  const send = useMutation({
    mutationFn: (request: AppealRequest) => client.createAppeal(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState }),
  });

  if (!params.success) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('appeal.title') }} />
        <Banner tone="error" text={t('appeal.invalidLink')} />
      </Screen>
    );
  }
  const restrictionId = params.data.restriction;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('appeal.title') }} />
      <Title>{t('appeal.title')}</Title>
      {send.isSuccess ? (
        <Banner tone="info" text={t('appeal.sent')} />
      ) : (
        <>
          <Body>{t('appeal.body')}</Body>
          <TextField
            label={t('appeal.label')}
            hint={t('appeal.hint')}
            value={statement}
            onChangeText={(text) => {
              setStatement(text);
              setInvalid(false);
            }}
            multiline
            maxLength={APPEAL_MAX}
            error={invalid ? t('appeal.invalid') : null}
          />
          {send.error === null ? null : toApiError(send.error).kind === 'conflict' ? (
            <Banner tone="warning" text={t('appeal.conflict')} />
          ) : (
            <ErrorBanner error={errorView(send.error)} />
          )}
          <Button
            label={t('appeal.submit')}
            busyLabel={t('appeal.sending')}
            busy={send.isPending}
            onPress={() => {
              const built = buildAppeal({ restrictionId }, statement);
              if (!built.ok) {
                setInvalid(true);
                return;
              }
              send.mutate(built.request);
            }}
          />
        </>
      )}
    </Screen>
  );
}
