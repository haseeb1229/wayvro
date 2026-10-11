import type { DeletionRequest } from '@wayvro/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDateTime } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, ErrorBanner, Heading, Screen, StateView, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { errorView, viewStateFromQuery } from '../../../core/ui/view-state';
import { deletionView, type DeletionView } from './account-security';
import { GuardedActionPanel } from './StepUpPanel';
import { SECURITY_KEYS, useAccountSecurityApi, useGuardedAction } from './use-account-security';

/**
 * Account deletion (U06): what is deleted and what may be kept (the server's `retained` list once requested), the
 * grace period, explicit blockers and Cancel. The request may need a fresh step-up.
 */
export default function DeletionScreen() {
  const { t } = useI18n();
  const api = useAccountSecurityApi();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: SECURITY_KEYS.deletion, queryFn: () => api.currentDeletion() });
  const refresh = useCallback(
    async (request: DeletionRequest) => {
      queryClient.setQueryData(SECURITY_KEYS.deletion, request);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.securityEvents });
    },
    [queryClient],
  );
  const run = useCallback(() => api.requestDeletion(), [api]);
  const onRequested = useCallback(
    (request: DeletionRequest) => {
      void refresh(request);
    },
    [refresh],
  );
  const request = useGuardedAction(run, onRequested);
  const cancel = useMutation({ mutationFn: (id: string) => api.cancelDeletion(id), onSuccess: refresh });

  const view = viewStateFromQuery(current, deletionView);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('deletion.title') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void current.refetch();
          }}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: t('deletion.title') }} />
      <Title>{t('deletion.title')}</Title>
      {cancel.isSuccess ? <Banner tone="info" text={t('deletion.cancelled')} /> : null}
      {view.data.kind === 'none' ? (
        <>
          <Body>{t('deletion.intro')}</Body>
          <Heading>{t('deletion.keptTitle')}</Heading>
          <Body>{t('deletion.keptBody')}</Body>
          <GuardedActionPanel action={request} />
          {request.phase.kind === 'step-up' || request.phase.kind === 'confirm-retry' ? null : (
            <Button
              variant="danger"
              label={t('deletion.request')}
              busyLabel={t('deletion.requesting')}
              busy={request.phase.kind === 'running'}
              onPress={() => {
                void confirmDestructive({
                  title: t('deletion.confirmTitle'),
                  body: t('deletion.confirmBody'),
                  confirm: t('deletion.request'),
                  cancel: t('common.cancel'),
                }).then((confirmed) => {
                  if (confirmed) request.start();
                });
              }}
            />
          )}
        </>
      ) : (
        <OpenRequest
          view={view.data}
          cancelling={cancel.isPending}
          cancelError={cancel.error}
          onCancel={(id) => {
            cancel.mutate(id);
          }}
        />
      )}
    </Screen>
  );
}

function OpenRequest(props: {
  readonly view: Extract<DeletionView, { kind: 'open' }>;
  readonly cancelling: boolean;
  readonly cancelError: unknown;
  readonly onCancel: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { view } = props;
  return (
    <>
      <Banner tone="warning" text={t(view.statusKey)} />
      {view.graceUntil === null ? null : <Body>{t('deletion.graceUntil', { date: formatDateTime(view.graceUntil, locale) })}</Body>}
      {view.blockerKeys.length === 0 ? null : (
        <View style={styles.group}>
          <Heading>{t('deletion.blockersTitle')}</Heading>
          {view.blockerKeys.map((key) => (
            <Body key={key}>{t(key)}</Body>
          ))}
        </View>
      )}
      {view.retained.length === 0 ? null : (
        <View style={styles.group}>
          <Heading>{t('deletion.retainedTitle')}</Heading>
          {view.retained.map((item) => (
            <Body key={`${item.category}-${item.basis}`}>{t('deletion.retainedItem', { category: item.category, basis: item.basis })}</Body>
          ))}
          <Body muted>{t('deletion.retainedPlaceholder')}</Body>
        </View>
      )}
      {props.cancelError === null ? null : <ErrorBanner error={errorView(props.cancelError)} />}
      {view.canCancel ? (
        <Button
          label={t('deletion.cancel')}
          busyLabel={t('deletion.cancelling')}
          busy={props.cancelling}
          onPress={() => {
            props.onCancel(view.id);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
