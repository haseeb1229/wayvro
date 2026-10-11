import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDateTime, type StringKey } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, ErrorBanner, Heading, Screen, StateView, Title } from '../../../core/ui/primitives';
import { colors, spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery, type UiErrorView } from '../../../core/ui/view-state';
import { GuardedActionPanel } from '../security/StepUpPanel';
import { useGuardedAction } from '../security/use-account-security';
import { revokeOneFailure, sessionsModel, type SessionRow } from './sessions';

type Feedback = { readonly kind: 'info'; readonly key: StringKey; readonly count?: number } | { readonly kind: 'error'; readonly error: UiErrorView } | null;

export function SessionsScreen() {
  const { client } = useServices();
  const { t, locale } = useI18n();
  const sessions = useQuery({ queryKey: QUERY_KEYS.sessions, queryFn: () => client.sessions() });
  const [feedback, setFeedback] = useState<Feedback>(null);

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) => client.revokeSession(sessionId),
    onSuccess: () => {
      setFeedback({ kind: 'info', key: 'sessions.revoked' });
    },
    onError: (error) => {
      const outcome = revokeOneFailure(error);
      setFeedback(outcome.kind === 'done' ? { kind: 'info', key: outcome.messageKey } : { kind: 'error', error: outcome.view });
    },
    onSettled: () => sessions.refetch(),
  });
  // P2.9: signing out every other device may need a fresh step-up; the panel below handles it and the retry.
  const runRevokeOthers = useCallback(() => client.revokeOtherSessions(), [client]);
  const onRevokedOthers = useCallback(
    (count: number) => {
      setFeedback({ kind: 'info', key: 'sessions.revokedOthers', count });
      void sessions.refetch();
    },
    [sessions],
  );
  const revokeOthers = useGuardedAction(runRevokeOthers, onRevokedOthers);
  const revokeOthersRunning = revokeOthers.phase.kind === 'running';
  const busy = revokeOne.isPending || revokeOthersRunning;

  const view = viewStateFromQuery(sessions, sessionsModel);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('sessions.title') }} />
        <StateView
          state={view}
          emptyKey="sessions.onlyThisPhone"
          onRetry={() => {
            void sessions.refetch();
          }}
        />
      </Screen>
    );
  }
  const model = view.data;
  const describe = (row: SessionRow): string =>
    [
      t(row.platformKey),
      t('sessions.appVersion', { version: row.appVersion }),
      t('sessions.signedIn', { date: formatDateTime(row.createdAt, locale) }),
      t('sessions.lastUsed', { date: formatDateTime(row.lastUsedAt, locale) }),
    ].join('\n');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('sessions.title') }} />
      <Title>{t('sessions.title')}</Title>
      {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      {feedback?.kind === 'info' ? <Banner tone="info" text={t(feedback.key, feedback.count === undefined ? undefined : { count: feedback.count })} /> : null}
      {feedback?.kind === 'error' ? <ErrorBanner error={feedback.error} /> : null}
      {model.current ? (
        <View style={styles.card}>
          <Heading>{t('sessions.current')}</Heading>
          <Body muted>{describe(model.current)}</Body>
        </View>
      ) : null}
      {model.others.length === 0 ? <Body muted>{t('sessions.onlyThisPhone')}</Body> : null}
      {model.others.map((row) => (
        <View key={row.id} style={styles.card}>
          <Body muted>{describe(row)}</Body>
          <Button
            variant="secondary"
            label={t('sessions.revoke')}
            disabled={busy}
            busy={revokeOne.isPending && revokeOne.variables === row.id}
            busyLabel={t('common.signingOut')}
            onPress={() => {
              void confirmDestructive({
                title: t('sessions.revokeConfirmTitle'),
                body: t('sessions.revokeConfirmBody'),
                confirm: t('sessions.revoke'),
                cancel: t('common.cancel'),
              }).then((confirmed) => {
                if (confirmed) revokeOne.mutate(row.id);
              });
            }}
          />
        </View>
      ))}
      <GuardedActionPanel action={revokeOthers} />
      {model.canRevokeOthers && revokeOthers.phase.kind !== 'step-up' && revokeOthers.phase.kind !== 'confirm-retry' ? (
        <Button
          variant="danger"
          label={t('sessions.revokeOthers')}
          busyLabel={t('common.signingOut')}
          busy={revokeOthersRunning}
          disabled={busy}
          onPress={() => {
            void confirmDestructive({
              title: t('sessions.revokeOthersConfirmTitle'),
              body: t('sessions.revokeOthersConfirmBody'),
              confirm: t('sessions.revokeOthers'),
              cancel: t('common.cancel'),
            }).then((confirmed) => {
              if (confirmed) revokeOthers.start();
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
});
