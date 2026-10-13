import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAccountState } from '../../../core/account/use-account-state';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { Banner, Body, Button, Screen, StateView, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { combineQueries, viewStateFromQuery } from '../../../core/ui/view-state';
import { useCompliance } from '../api/driver-queries';
import { healthModel } from '../readiness/health';
import { useDriverText } from '../ui/DriverUi';

/**
 * Restriction / account health `/drive/health` (lazy; V13, K19 "suspended" = a DRIVER_ROLE restriction = earning
 * paused): the server's Driver/Partner-side restrictions with the existing copy, effective-until and the existing
 * appeal path. Rider use is stated as unaffected unless an ACCOUNT-scope restriction exists.
 */
export default function DriveHealthScreen() {
  const dt = useDriverText();
  const { t, locale } = useI18n();
  const router = useRouter();
  const account = useAccountState();
  const compliance = useCompliance();
  const view = viewStateFromQuery(combineQueries(account, compliance), ([a, c]) => healthModel(a, c));
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('drive.health.title') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void account.refetch();
            void compliance.refetch();
          }}
        />
      </Screen>
    );
  }
  const { restrictions, earningPaused, riderStatementKey, accountRestricted } = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('drive.health.title') }} />
      <Title>{dt('drive.health.title')}</Title>
      {view.stale ? <Banner tone="stale" text={t('common.staleData')} /> : null}
      {earningPaused ? <Banner tone="warning" text={dt('drive.health.paused')} /> : null}
      {restrictions.length === 0 ? <Body>{dt('drive.health.none')}</Body> : null}
      {restrictions.map((r) => (
        <View key={r.id} style={styles.group}>
          <Banner tone="warning" text={`${dt(r.scopeKey)}: ${dt(r.key)}`} />
          <Body muted>{r.effectiveUntil === null ? dt('compliance.indefinite') : dt('compliance.until', { date: formatDate(r.effectiveUntil, locale) })}</Body>
          <Body muted>{dt('driver.reference', { code: r.reasonCode })}</Body>
          {r.appealable ? (
            <Button
              variant="secondary"
              label={dt('compliance.appealRestriction')}
              onPress={() => {
                router.push({ pathname: '/earn/appeal', params: { restriction: r.id } });
              }}
            />
          ) : null}
        </View>
      ))}
      <Banner tone={accountRestricted ? 'warning' : 'info'} text={dt(riderStatementKey)} />
      <TranslationPendingNote />
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.xs } });
