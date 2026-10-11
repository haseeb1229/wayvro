import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { Banner, Body, Button, Heading } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import type { RestrictionNoticeItem } from './restrictions';

export function RestrictionNotices({ items }: { readonly items: readonly RestrictionNoticeItem[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
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
          {item.appealable ? (
            <>
              <Body muted>{t('restriction.appealable')}</Body>
              <Button
                variant="secondary"
                label={t('restriction.appeal')}
                onPress={() => {
                  router.push({ pathname: '/account/appeal', params: { restriction: item.id } });
                }}
              />
            </>
          ) : null}
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
