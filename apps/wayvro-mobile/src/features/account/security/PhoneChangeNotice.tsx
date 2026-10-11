import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDateTime } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, ErrorBanner, Heading } from '../../../core/ui/primitives';
import { colors, spacing } from '../../../core/ui/tokens';
import { errorView } from '../../../core/ui/view-state';
import { phoneChangeNotice } from './account-security';
import { SECURITY_KEYS, useAccountSecurityApi } from './use-account-security';

/**
 * "This wasn't me" (K08/S13): any open phone change or recovery of this account is shown prominently with a Cancel
 * action, on the home and security screens, so a session on the old phone can stop a change it did not start.
 */
export function PhoneChangeNotice() {
  const { t, locale } = useI18n();
  const api = useAccountSecurityApi();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: SECURITY_KEYS.phoneChange, queryFn: () => api.currentPhoneChange() });
  const [cancelled, setCancelled] = useState(false);
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelPhoneChange(id),
    onSuccess: async () => {
      setCancelled(true);
      await queryClient.invalidateQueries({ queryKey: SECURITY_KEYS.phoneChange });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.securityEvents });
    },
  });

  if (cancelled) return <Banner tone="info" text={t('phoneNotice.cancelled')} />;
  const notice = phoneChangeNotice(current.data ?? null);
  if (notice === null) return null;
  return (
    <View style={styles.card} accessibilityRole="alert">
      <Heading>{t('phoneNotice.title')}</Heading>
      <Body>{t(notice.kindKey, { masked: notice.maskedNewPhone })}</Body>
      {notice.cooldownUntil === null ? null : <Body>{t('phoneNotice.cooldown', { date: formatDateTime(notice.cooldownUntil, locale) })}</Body>}
      {notice.inReview ? <Body muted>{t('phoneNotice.review')}</Body> : null}
      <Body>{t('phoneNotice.notMe')}</Body>
      {cancel.error === null ? null : <ErrorBanner error={errorView(cancel.error)} />}
      <Button
        variant="danger"
        label={t('phoneNotice.cancel')}
        busyLabel={t('phoneNotice.cancelling')}
        busy={cancel.isPending}
        onPress={() => {
          void confirmDestructive({
            title: t('phoneNotice.cancelConfirmTitle'),
            body: t('phoneNotice.cancelConfirmBody'),
            confirm: t('phoneNotice.cancel'),
            cancel: t('common.notNow'),
          }).then((confirmed) => {
            if (confirmed) cancel.mutate(notice.id);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: 8, borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.errorBackground },
});
