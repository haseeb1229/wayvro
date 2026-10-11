import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, ErrorBanner, StateView, Title } from '../../../core/ui/primitives';
import { errorView, viewStateFromQuery } from '../../../core/ui/view-state';
import { SignOutButton } from '../home/SignOutButton';
import { reviewView } from './account-security';
import { SECURITY_KEYS, useAccountSecurityApi } from './use-account-security';

/**
 * Dormant-number review (S12), shown in a RESTRICTED session: it exposes NO data of the earlier account. "I'm new"
 * returns a session for a fresh account, which replaces the stored tokens; "This is my account" (only when the server
 * offers it) starts an in-person check by a person.
 */
export function RecoveryReview() {
  const { t } = useI18n();
  const { session } = useServices();
  const api = useAccountSecurityApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: SECURITY_KEYS.recoveryReview, queryFn: () => api.currentRecoveryReview() });
  const [incomplete, setIncomplete] = useState(false);

  const choose = useMutation({
    mutationFn: (args: { id: string; choice: 'I_AM_NEW' | 'THIS_IS_MY_ACCOUNT' }) => api.chooseRecoveryReview(args.id, args.choice),
    onSuccess: async (outcome) => {
      if (outcome.newAccountSession !== null) {
        // The new account's tokens replace the restricted session in one write; nothing of the earlier account remains.
        const switched = await session.switchAccount(outcome.newAccountSession);
        if (switched.complete) router.replace('/');
        else setIncomplete(true);
        return;
      }
      queryClient.setQueryData(SECURITY_KEYS.recoveryReview, outcome.review);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
    },
  });

  const startNew = (id: string) => {
    void confirmDestructive({
      title: t('review.newConfirmTitle'),
      body: t('review.newConfirmBody'),
      confirm: t('review.iAmNew'),
      cancel: t('common.cancel'),
    }).then((confirmed) => {
      if (confirmed) choose.mutate({ id, choice: 'I_AM_NEW' });
    });
  };

  const view = viewStateFromQuery(current, reviewView);
  if (view.kind !== 'ready') {
    return (
      <StateView
        state={view}
        emptyKey="review.none"
        onRetry={() => {
          void current.refetch();
        }}
      />
    );
  }
  const review = view.data;
  const newButton = (id: string, labelKey: 'review.iAmNew' | 'review.startNewInstead') => (
    <>
      <Button
        label={t(labelKey)}
        busyLabel={t('review.saving')}
        busy={choose.isPending && choose.variables.choice === 'I_AM_NEW'}
        disabled={choose.isPending}
        onPress={() => {
          startNew(id);
        }}
      />
      <Body muted>{t('review.iAmNewHint')}</Body>
    </>
  );
  return (
    <>
      <Title>{t('review.title')}</Title>
      <Body>{t('review.body')}</Body>
      {incomplete ? (
        <>
          <Banner tone="warning" text={t('review.switchIncomplete')} />
          <Button
            label={t('common.continue')}
            onPress={() => {
              router.replace('/');
            }}
          />
        </>
      ) : null}
      {choose.error === null ? null : <ErrorBanner error={errorView(choose.error)} />}
      {review.kind === 'none' ? <Banner tone="info" text={t('review.none')} /> : null}
      {review.kind === 'resolved' ? <Banner tone="info" text={t('review.resolved')} /> : null}
      {review.kind === 'choose' ? (
        <>
          {review.canStartNew ? newButton(review.id, 'review.iAmNew') : null}
          {review.canClaim ? (
            <>
              <Button
                variant="secondary"
                label={t('review.claim')}
                busyLabel={t('review.saving')}
                busy={choose.isPending && choose.variables.choice === 'THIS_IS_MY_ACCOUNT'}
                disabled={choose.isPending}
                onPress={() => {
                  choose.mutate({ id: review.id, choice: 'THIS_IS_MY_ACCOUNT' });
                }}
              />
              <Body muted>{t('review.claimHint')}</Body>
            </>
          ) : null}
        </>
      ) : null}
      {review.kind === 'in-review' ? (
        <>
          <Banner tone="info" text={t('review.inReview')} />
          {review.canStartNew ? newButton(review.id, 'review.startNewInstead') : null}
        </>
      ) : null}
      {review.kind === 'denied' ? (
        <>
          <Banner tone="warning" text={t('review.denied')} />
          {review.canStartNew ? newButton(review.id, 'review.iAmNew') : null}
        </>
      ) : null}
      <SignOutButton />
    </>
  );
}
