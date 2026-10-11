import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate, policyLocaleFor } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, LinkRow, Screen, StateView, Title } from '../../../core/ui/primitives';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { legalListModel } from './legal';

export function LegalListScreen() {
  const { client } = useServices();
  const { t, locale } = useI18n();
  const router = useRouter();
  const policyLocale = policyLocaleFor(locale);
  const policies = useQuery({ queryKey: QUERY_KEYS.policies(policyLocale), queryFn: () => client.policies(policyLocale) });
  const view = viewStateFromQuery(policies, legalListModel, (items) => items.length === 0);

  return (
    <Screen scroll={view.kind === 'ready'}>
      <Stack.Screen options={{ title: t('legal.title') }} />
      {view.kind !== 'ready' ? (
        <StateView
          state={view}
          emptyKey="legal.empty"
          onRetry={() => {
            void policies.refetch();
          }}
        />
      ) : (
        <>
          <Title>{t('legal.title')}</Title>
          {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
          {locale === 'ur-Latn' ? <Body muted>{t('legal.englishOnly')}</Body> : null}
          {view.data.map((item) => (
            <LinkRow
              key={item.policyKey}
              label={item.title}
              detail={[t('common.version', { version: item.version }), item.placeholder ? t('common.placeholderNotice') : null]
                .filter((s): s is string => s !== null)
                .concat(t('common.effectiveFrom', { date: formatDate(item.effectiveAt, locale) }))
                .join(' · ')}
              onPress={() => {
                router.push({
                  pathname: '/legal/[policyKey]/[version]',
                  params: { policyKey: item.policyKey, version: String(item.version), locale: policyLocale },
                });
              }}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
