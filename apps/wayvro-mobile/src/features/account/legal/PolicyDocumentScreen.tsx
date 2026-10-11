import { skipToken, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate, policyLocaleFor } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Heading, PlaceholderBadge, Screen, StateView, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { parsePolicyRouteParams, policyDocumentModel } from './legal';

export function PolicyDocumentScreen() {
  const { client } = useServices();
  const { t, locale } = useI18n();
  const params = parsePolicyRouteParams(useLocalSearchParams(), policyLocaleFor(locale));
  const document = useQuery({
    queryKey: params.ok ? QUERY_KEYS.policyDocument(params.policyKey, params.version, params.locale) : ['legal', 'policy', 'invalid'],
    queryFn: params.ok ? () => client.policyDocument(params.policyKey, params.version, params.locale) : skipToken,
  });

  if (!params.ok) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('legal.title') }} />
        <Banner tone="error" text={t('legal.empty')} />
      </Screen>
    );
  }

  const view = viewStateFromQuery(document, (doc) => policyDocumentModel(doc, locale === 'en'));
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('legal.title') }} />
        <StateView
          state={view}
          emptyKey="legal.empty"
          onRetry={() => {
            void document.refetch();
          }}
        />
      </Screen>
    );
  }
  const doc = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: doc.title }} />
      <Title>{doc.title}</Title>
      {doc.placeholder ? <PlaceholderBadge /> : null}
      {doc.shownInEnglish ? <Body muted>{t('legal.englishOnly')}</Body> : null}
      <Body muted>{`${t('common.version', { version: doc.version })} · ${t('common.effectiveFrom', { date: formatDate(doc.effectiveAt, locale) })}`}</Body>
      {doc.sections.map((section, index) => (
        <View key={`${String(index)}-${section.heading}`} style={styles.section}>
          {section.heading === '' ? null : <Heading>{section.heading}</Heading>}
          {section.paragraphs.map((paragraph, p) => (
            <Body key={String(p)}>{paragraph}</Body>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ section: { gap: spacing.sm } });
