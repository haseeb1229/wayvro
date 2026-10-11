import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { z } from 'zod';
import { APPEAL_MAX, buildAppeal, type AppealRequest, type AppealTarget } from '../../../core/account/appeal';
import { toApiError } from '../../../core/api/errors';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, Screen, TextField, Title } from '../../../core/ui/primitives';
import { DRIVER_KEYS } from '../api/driver-queries';
import { driverErrorView } from '../ui/driver-errors';
import { DriverErrorBanner, useDriverText } from '../ui/DriverUi';

/**
 * Appeal (K05): a rejected application's review decision, or an appealable Driver/Partner restriction. The statement
 * is the applicant's own words; a different human reviewer decides. Route params are untrusted and validated.
 */
const ParamsSchema = z.union([z.object({ decision: z.uuid() }), z.object({ restriction: z.uuid() })]);

export default function AppealScreen() {
  const dt = useDriverText();
  const parsed = ParamsSchema.safeParse(useLocalSearchParams());
  if (!parsed.success) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('appeal.title') }} />
        <Banner tone="error" text={dt('appeal.invalidLink')} />
      </Screen>
    );
  }
  const target: AppealTarget = 'decision' in parsed.data ? { reviewDecisionId: parsed.data.decision } : { restrictionId: parsed.data.restriction };
  return <AppealForm target={target} />;
}

function AppealForm({ target }: { readonly target: AppealTarget }) {
  const dt = useDriverText();
  const { client } = useServices();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState('');
  const [invalid, setInvalid] = useState(false);
  const title = dt('reviewDecisionId' in target ? 'appeal.title' : 'appeal.titleRestriction');
  const send = useMutation({
    mutationFn: (request: AppealRequest) => client.createAppeal(request),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application }),
        queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.compliance }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState }),
      ]);
    },
  });
  const conflict = send.error !== null && toApiError(send.error).kind === 'conflict';

  if (send.isSuccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>{title}</Title>
        <Banner tone="info" text={dt('appeal.sent')} />
        <Button
          label={dt('driver.backToApplication')}
          onPress={() => {
            router.back();
          }}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Title>{title}</Title>
      <Body>{dt('appeal.body')}</Body>
      <TextField
        label={dt('appeal.label')}
        hint={dt('appeal.hint')}
        value={statement}
        onChangeText={(text) => {
          setStatement(text);
          setInvalid(false);
        }}
        multiline
        maxLength={APPEAL_MAX}
        error={invalid ? dt('appeal.invalid') : null}
      />
      {conflict ? (
        <Banner tone="warning" text={dt('appeal.conflict')} />
      ) : (
        <DriverErrorBanner error={send.error === null ? null : driverErrorView(send.error)} />
      )}
      <Button
        label={dt('appeal.submit')}
        busyLabel={dt('appeal.sending')}
        busy={send.isPending}
        onPress={() => {
          const built = buildAppeal(target, statement);
          if (!built.ok) {
            setInvalid(true);
            return;
          }
          send.mutate(built.request);
        }}
      />
    </Screen>
  );
}
