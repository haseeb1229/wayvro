import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DateParts } from '../../../core/input/digits';
import { useI18n } from '../../../core/i18n/I18nProvider';
import type { TranslationParams } from '../../../core/i18n/strings';
import { Banner, Body, Button, ErrorBanner, Heading, TextField } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import type { RenewalAppealView } from '../compliance/compliance';
import { driverText, type DriverStringKey } from '../i18n/driver-strings';
import type { ReasonItem } from '../onboarding/status';
import type { DriverErrorView } from './driver-errors';

/** Driver/Partner copy in the current UI language. */
export function useDriverText(): (key: DriverStringKey, params?: TranslationParams) => string {
  const { locale } = useI18n();
  return useCallback((key: DriverStringKey, params?: TranslationParams) => driverText(locale, key, params), [locale]);
}

export function DriverErrorBanner({ error }: { readonly error: DriverErrorView | null }) {
  const dt = useDriverText();
  const router = useRouter();
  if (error === null) return null;
  if (error.source === 'core') return <ErrorBanner error={error.view} />;
  return (
    <View style={styles.group}>
      <Banner tone="error" text={dt(error.key)} />
      {error.action === 'policies' ? (
        <Button
          variant="secondary"
          label={dt('explain.reviewPolicies')}
          onPress={() => {
            router.push('/earn/policies');
          }}
        />
      ) : null}
    </View>
  );
}

/** A titled block of explanatory text (K14). */
export function InfoSection({ title, body }: { readonly title: DriverStringKey; readonly body: DriverStringKey }) {
  const dt = useDriverText();
  return (
    <View style={styles.group}>
      <Heading>{dt(title)}</Heading>
      <Body>{dt(body)}</Body>
    </View>
  );
}

/** Review reasons: catalogued codes get plain-language copy; every code is also shown as a reference for support. */
export function ReasonList({ reasons }: { readonly reasons: readonly ReasonItem[] }) {
  const dt = useDriverText();
  if (reasons.length === 0) return null;
  return (
    <View style={styles.group} accessibilityRole="list">
      <Heading>{dt('status.reasonsTitle')}</Heading>
      {reasons.map((reason) => (
        <View key={reason.code} style={styles.reason}>
          {reason.key === null ? null : <Body>{dt(reason.key)}</Body>}
          <Body muted>{dt('driver.reference', { code: reason.code })}</Body>
        </View>
      ))}
    </View>
  );
}

/**
 * Appeal of a rejected renewal: the existing appeal flow on the server-named REJECT decision, or the appeal's status in
 * plain words. Nothing is shown when the server offers no appeal.
 */
export function RenewalAppealNotice({ appeal }: { readonly appeal: RenewalAppealView }) {
  const dt = useDriverText();
  const router = useRouter();
  switch (appeal.kind) {
    case 'none':
      return null;
    case 'status':
      return <Body>{dt(appeal.key)}</Body>;
    case 'can-appeal':
      return (
        <View style={styles.group}>
          <Body muted>{dt('renewalAppeal.offer')}</Body>
          <Button
            variant="secondary"
            label={dt('renewalAppeal.appeal')}
            onPress={() => {
              router.push({ pathname: '/earn/appeal', params: { decision: appeal.decisionId } });
            }}
          />
        </View>
      );
  }
}

/** Day / month / year entry (any digit script; validated by the form adapters). */
export function DateFields(props: {
  readonly label: string;
  readonly value: DateParts;
  readonly onChange: (next: DateParts) => void;
  readonly error?: string | null;
}) {
  const dt = useDriverText();
  const { value, onChange } = props;
  return (
    <View style={styles.group} accessibilityLabel={props.label}>
      <Heading>{props.label}</Heading>
      <View style={styles.dateRow}>
        <View style={styles.dateCell}>
          <TextField
            label={dt('date.day')}
            value={value.day}
            onChangeText={(day) => {
              onChange({ ...value, day });
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={styles.dateCell}>
          <TextField
            label={dt('date.month')}
            value={value.month}
            onChangeText={(month) => {
              onChange({ ...value, month });
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={styles.yearCell}>
          <TextField
            label={dt('date.year')}
            value={value.year}
            onChangeText={(year) => {
              onChange({ ...value, year });
            }}
            keyboardType="number-pad"
            maxLength={4}
            error={props.error ?? null}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  reason: { gap: spacing.xs },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateCell: { minWidth: 96, flexGrow: 1 },
  yearCell: { minWidth: 128, flexGrow: 2 },
});
