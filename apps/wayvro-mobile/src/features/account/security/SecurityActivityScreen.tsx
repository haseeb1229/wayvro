import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDateTime } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Screen, StateView, Title } from '../../../core/ui/primitives';
import { colors, spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { securityEventsModel } from './security-activity';

export function SecurityActivityScreen() {
  const { client } = useServices();
  const { t, locale } = useI18n();
  const events = useQuery({ queryKey: QUERY_KEYS.securityEvents, queryFn: () => client.securityEvents() });
  const view = viewStateFromQuery(events, securityEventsModel, (rows) => rows.length === 0);

  return (
    <Screen scroll={view.kind === 'ready'}>
      <Stack.Screen options={{ title: t('security.title') }} />
      {view.kind !== 'ready' ? (
        <StateView
          state={view}
          emptyKey="security.empty"
          onRetry={() => {
            void events.refetch();
          }}
        />
      ) : (
        <>
          <Title>{t('security.title')}</Title>
          {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
          <Body muted>{t('security.hint')}</Body>
          {view.data.map((row) => (
            <View key={row.id} style={styles.row} accessible>
              <Body>{t(row.labelKey)}</Body>
              <Body muted>{formatDateTime(row.occurredAt, locale)}</Body>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
