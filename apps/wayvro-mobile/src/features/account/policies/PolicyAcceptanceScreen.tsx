import type { AccountState, PolicyKey } from '@wayvro/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { policyLocaleFor } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, ErrorBanner, Heading, LinkRow, PlaceholderBadge, Screen, StateView, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { combineQueries, viewStateFromQuery } from '../../../core/ui/view-state';
import { SignOutButton } from '../home/SignOutButton';
import { acceptanceError, acceptPending, policyAcceptanceModel, type AcceptanceResult } from './policy-acceptance';

export function PolicyAcceptanceScreen() {
  const { client } = useServices();
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const policyLocale = policyLocaleFor(locale);
  const [acceptedNow, setAcceptedNow] = useState<ReadonlySet<PolicyKey>>(new Set());

  const consents = useQuery({ queryKey: QUERY_KEYS.consents, queryFn: () => client.consents() });
  const localized = useQuery({ queryKey: QUERY_KEYS.policies(policyLocale), queryFn: () => client.policies(policyLocale) });
  const english = useQuery({ queryKey: QUERY_KEYS.policies('en'), queryFn: () => client.policies('en') });
  const lists = combineQueries(localized, english);
  const view = viewStateFromQuery(
    combineQueries(consents, lists),
    ([c, [l, e]]) => policyAcceptanceModel({ consents: c, localized: l, english: e, uiIsEnglish: locale === 'en', acceptedNow }),
    (m) => m.items.length === 0 && m.syncing.length === 0,
  );

  const refetchAll = async () => {
    await Promise.all([consents.refetch(), localized.refetch(), english.refetch()]);
  };

  const accept = useMutation({
    mutationFn: (items: Parameters<typeof acceptPending>[0]) => acceptPending(items, (request) => client.recordConsent(request)),
    onSuccess: async (result: AcceptanceResult) => {
      setAcceptedNow((prev) => new Set([...prev, ...result.accepted]));
      const failure = acceptanceError(result);
      if (failure?.refetch) await refetchAll();
      const actions = result.requiredActions;
      if (actions !== null) {
        // Server truth from the last record: the account gate moves on as soon as ACCEPT_POLICIES is gone.
        queryClient.setQueryData<AccountState>(QUERY_KEYS.accountState, (old) => (old ? { ...old, requiredActions: actions } : old));
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.consents });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
    },
  });
  const failure = accept.data ? acceptanceError(accept.data) : null;

  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('policies.title') }} />
        <StateView
          state={view}
          emptyKey="policies.empty"
          onRetry={() => {
            void refetchAll();
          }}
        />
        {view.kind === 'empty' ? (
          <Button
            label={t('common.continue')}
            onPress={() => {
              void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
            }}
          />
        ) : null}
      </Screen>
    );
  }

  const model = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('policies.title') }} />
      <Title>{t('policies.title')}</Title>
      <Body>{t('policies.body')}</Body>
      {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      {model.items.map((item) => (
        <View key={item.policyKey} style={styles.item}>
          <Heading>{item.title}</Heading>
          <Body muted>{t('common.version', { version: item.version })}</Body>
          {item.placeholder ? <PlaceholderBadge /> : null}
          {item.shownInEnglish ? <Body muted>{t('legal.englishOnly')}</Body> : null}
          {item.changeSummary === null ? null : <Body>{t('policies.whatChanged', { summary: item.changeSummary })}</Body>}
          {item.accepted ? <Banner tone="info" text={t('policies.accepted')} /> : null}
          <LinkRow
            label={t('policies.read')}
            onPress={() => {
              router.push({
                pathname: '/legal/[policyKey]/[version]',
                params: { policyKey: item.policyKey, version: String(item.version), locale: item.locale },
              });
            }}
          />
        </View>
      ))}
      {model.syncing.length > 0 ? <Banner tone="info" text={t('policies.syncing')} /> : null}
      {failure ? <ErrorBanner error={failure.view} /> : null}
      <Button
        label={t('policies.accept')}
        busyLabel={t('policies.accepting')}
        busy={accept.isPending}
        disabled={!model.canAccept}
        onPress={() => {
          accept.mutate(model.items);
        }}
      />
      <Body muted>{t('policies.declineHint')}</Body>
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({ item: { gap: spacing.sm, paddingVertical: spacing.sm } });
