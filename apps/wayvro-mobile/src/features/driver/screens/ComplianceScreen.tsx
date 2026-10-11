import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { Banner, Body, Button, Heading, Screen, StateView, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { useCompliance, useComplianceDistricts } from '../api/driver-queries';
import { complianceModel, type BlockerView, type DocumentRowView, type RestrictionView } from '../compliance/compliance';
import { districtName, type District } from '../onboarding/districts';
import { RenewalAppealNotice, useDriverText } from '../ui/DriverUi';
import { cityLabel, documentLabel } from '../ui/labels';

/**
 * Verified driver status (D03, V13): the server's earning-eligibility evaluation with every blocker in plain words,
 * documents with expiry and renewal state, and Driver/Partner restrictions. Rider use is never changed from here.
 */
export default function ComplianceScreen() {
  const dt = useDriverText();
  const { t } = useI18n();
  const compliance = useCompliance();
  const districts = useComplianceDistricts(compliance.data);
  const view = viewStateFromQuery(compliance, complianceModel);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('compliance.title') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void compliance.refetch();
          }}
        />
      </Screen>
    );
  }
  const model = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('compliance.title') }} />
      <Title>{dt('compliance.title')}</Title>
      <Body>{dt('compliance.body')}</Body>
      {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      <Body muted>{dt('compliance.profile', { state: dt(model.profileStateKey) })}</Body>
      {model.eligibility.map((row) => {
        const params = { category: dt(`category.${row.category}`), city: cityLabel(dt, row.cityCode) };
        return (
          <View key={`${row.cityCode}-${row.category}`} style={styles.group}>
            <Heading>{dt(row.eligible ? 'compliance.eligibleTitle' : 'compliance.notEligibleTitle', params)}</Heading>
            {row.blockers.map((blocker, index) => (
              <BlockerLine key={`${blocker.key}-${String(index)}`} blocker={blocker} />
            ))}
          </View>
        );
      })}
      <Banner tone="info" text={dt('compliance.goingOnlineLater')} />
      <Heading>{dt('compliance.documentsTitle')}</Heading>
      {model.documents.length === 0 ? <Body muted>{dt('compliance.empty')}</Body> : null}
      {model.documents.map((doc) => (
        <DocumentRow key={doc.id} doc={doc} districts={districts} />
      ))}
      {model.restrictions.length > 0 ? <Heading>{dt('compliance.restrictionsTitle')}</Heading> : null}
      {model.restrictions.map((r) => (
        <RestrictionRow key={r.id} restriction={r} />
      ))}
      <Banner tone="info" text={dt('driver.riderUnaffected')} />
      <TranslationPendingNote />
    </Screen>
  );
}

function BlockerLine({ blocker }: { readonly blocker: BlockerView }) {
  const dt = useDriverText();
  const reason = dt(blocker.key);
  return <Body>{blocker.documentType === null ? reason : dt('blocker.document', { document: documentLabel(dt, blocker.documentType), reason })}</Body>;
}

function DocumentRow({ doc, districts }: { readonly doc: DocumentRowView; readonly districts: readonly District[] }) {
  const dt = useDriverText();
  const { locale } = useI18n();
  const router = useRouter();
  return (
    <View style={styles.group} accessibilityRole="summary">
      <Heading>{documentLabel(dt, doc.documentType)}</Heading>
      {doc.districtCode === null ? null : <Body muted>{dt('docs.district', { district: districtName(locale, doc.districtCode, districts) })}</Body>}
      <Body
        muted
      >{`${dt(doc.statusKey)} · ${doc.expiresOn === null ? dt('compliance.noExpiry') : dt('compliance.expires', { date: formatDate(doc.expiresOn, locale) })}`}</Body>
      {doc.renewalDue ? <Banner tone="warning" text={dt('compliance.renewalDue')} /> : null}
      {doc.renewalStatusKey === null ? null : <Body muted>{dt(doc.renewalStatusKey)}</Body>}
      <RenewalAppealNotice appeal={doc.appeal} />
      {doc.action === 'start' || doc.action === 'continue' ? (
        <Button
          variant={doc.action === 'start' ? 'primary' : 'secondary'}
          label={dt(doc.action === 'start' ? 'compliance.renew' : 'compliance.continueRenewal')}
          onPress={() => {
            router.push({ pathname: '/earn/renewal', params: { document: doc.id } });
          }}
        />
      ) : null}
    </View>
  );
}

function RestrictionRow({ restriction }: { readonly restriction: RestrictionView }) {
  const dt = useDriverText();
  const { locale } = useI18n();
  const router = useRouter();
  return (
    <View style={styles.group}>
      <Banner tone="warning" text={`${dt(restriction.scopeKey)}: ${dt(restriction.key)}`} />
      <Body muted>
        {restriction.effectiveUntil === null ? dt('compliance.indefinite') : dt('compliance.until', { date: formatDate(restriction.effectiveUntil, locale) })}
      </Body>
      <Body muted>{dt('driver.reference', { code: restriction.reasonCode })}</Body>
      {restriction.appealable ? (
        <Button
          variant="secondary"
          label={dt('compliance.appealRestriction')}
          onPress={() => {
            router.push({ pathname: '/earn/appeal', params: { restriction: restriction.id } });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm, paddingVertical: spacing.xs } });
