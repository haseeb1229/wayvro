import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { Banner, Body, Heading } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import type { RestrictionNoticeItem } from './restrictions';

export function RestrictionNotices({ items }: { readonly items: readonly RestrictionNoticeItem[] }) {
  const { t, locale } = useI18n();
  if (items.length === 0) return null;
  return (
    <View style={styles.list} accessibilityRole="summary">
      <Heading>{t('restriction.title')}</Heading>
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <Banner tone="warning" text={t(item.messageKey)} />
          <Body muted>
            {item.effectiveUntil === null ? t('restriction.indefinite') : t('restriction.until', { date: formatDate(item.effectiveUntil, locale) })}
          </Body>
          {item.appealable ? <Body muted>{t('restriction.appealable')}</Body> : null}
          <Body muted>{t('restriction.reference', { code: item.reasonCode })}</Body>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  item: { gap: spacing.xs },
});
