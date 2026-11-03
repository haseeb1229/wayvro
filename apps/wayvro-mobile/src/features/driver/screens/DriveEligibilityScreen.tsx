import type { DriverApplication } from '@wayvro/contracts';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { useIntentNavigation } from '../../../core/intents/use-intents';
import { Card, Section } from '../../../core/ui/components';
import { Banner, Body, Button, Heading, Screen, StateView, Title, useDirection } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { useCompliance, useDriverApplication } from '../api/driver-queries';
import { eligibilityModel, type CodedItem, type ProductRowView, type VehicleEligibilityView } from '../readiness/eligibility';
import { markGlyph, markKey } from '../readiness/marks';
import { useDriverText } from '../ui/DriverUi';
import { cityLabel, productLabel } from '../ui/labels';

type Vehicle = DriverApplication['vehicles'][number];

/**
 * Eligibility per service product `/drive/eligibility` (lazy; H10 display, K19; UX doc §10.2): per vehicle × product the
 * SERVER's result with plain reasons (model year, seats, AC, body type, legal gate — BIKE/RICKSHAW "Not offered in
 * Lahore yet"). Display only: nothing here enables earning; dispatch eligibility is Phase 4.
 */
export default function DriveEligibilityScreen() {
  const dt = useDriverText();
  const { t } = useI18n();
  const openIntent = useIntentNavigation();
  const compliance = useCompliance();
  const { application } = useDriverApplication();
  const view = viewStateFromQuery(compliance, eligibilityModel);
  const statusButton = (
    <Button
      variant="secondary"
      label={dt('drive.eligibility.openStatus')}
      onPress={() => {
        openIntent({ kind: 'OPEN_DRIVER_COMPLIANCE' });
      }}
    />
  );
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('drive.eligibility.title') }} />
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
  const vehicles = application.data?.vehicles ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('drive.eligibility.title') }} />
      <Title>{dt('drive.eligibility.title')}</Title>
      {view.stale ? <Banner tone="stale" text={t('common.staleData')} /> : null}
      {model.kind === 'unavailable' ? <Banner tone="info" text={dt('drive.eligibility.unavailable')} /> : null}
      {model.kind === 'no-vehicle' ? <Body>{dt('drive.eligibility.none')}</Body> : null}
      {model.kind === 'vehicles' ? (
        <>
          <Body>{dt('drive.eligibility.intro')}</Body>
          {model.vehicles.map((v) => (
            <VehicleSection key={v.vehicleId} vehicle={v} known={vehicles.find((x) => x.id === v.vehicleId) ?? null} />
          ))}
          <Body muted>{dt('drive.eligibility.recheck')}</Body>
        </>
      ) : null}
      {statusButton}
    </Screen>
  );
}

function VehicleSection({ vehicle, known }: { readonly vehicle: VehicleEligibilityView; readonly known: Vehicle | null }) {
  const dt = useDriverText();
  const name =
    known !== null
      ? `${known.make} ${known.model} · ${known.plateDisplay}`
      : vehicle.category !== null
        ? dt(`category.${vehicle.category}`)
        : dt('overview.vehicle');
  const city = vehicle.cityCode === null ? '' : cityLabel(dt, vehicle.cityCode);
  return (
    <Section title={dt('drive.eligibility.vehicle', { vehicle: name })}>
      {vehicle.products.map((p) => (
        <ProductCard key={p.productCode} product={p} city={city} />
      ))}
    </Section>
  );
}

function ProductCard({ product, city }: { readonly product: ProductRowView; readonly city: string }) {
  const dt = useDriverText();
  const { t } = useI18n();
  const dir = useDirection();
  const coded = (item: CodedItem): string => (item.key === null ? dt('driver.reference', { code: item.code }) : dt(item.key, { city }));
  const title = `${productLabel(t, product.productCode)}: ${dt(product.resultKey)}`;
  const reasons = product.reasons.map(coded);
  const missing = product.missing.map(coded);
  const spoken = [title, ...reasons, ...(missing.length > 0 ? [dt('drive.eligibility.missingTitle'), ...missing] : [])].join('. ');
  return (
    <Card label={spoken}>
      <View style={[styles.titleRow, dir.row]}>
        <Body>{markGlyph(product.mark)}</Body>
        <View style={styles.fill}>
          <Heading>{title}</Heading>
          <Body muted>{dt(markKey(product.mark))}</Body>
        </View>
      </View>
      {reasons.map((text, index) => (
        <Body key={`r${String(index)}`}>{text}</Body>
      ))}
      {missing.length > 0 ? <Body muted>{dt('drive.eligibility.missingTitle')}</Body> : null}
      {missing.map((text, index) => (
        <Body key={`m${String(index)}`}>{text}</Body>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { gap: spacing.sm, alignItems: 'flex-start' },
  fill: { flex: 1 },
});
