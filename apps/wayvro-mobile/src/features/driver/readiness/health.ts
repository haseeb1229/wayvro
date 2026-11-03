import type { AccountState, DriverCompliance } from '@wayvro/contracts';
import { restrictionView, type RestrictionView } from '../compliance/compliance';
import type { DriverStringKey } from '../i18n/driver-strings';
import { driverSideRestrictions, riderUseRestricted } from './readiness';

/**
 * Restriction / account health `/drive/health` (P3.8; V13, K19 "suspended"; UX doc §10.3). Lists the Driver/Partner-side
 * restrictions (DRIVER_ROLE, VEHICLE, SERVICE_CAPABILITY, CITY_CATEGORY) from the server's compliance view with the
 * existing copy, effective-until and appealability. A DRIVER_ROLE restriction means "earning paused"; rider use is
 * stated as unaffected unless an ACCOUNT-scope restriction affecting rider use exists. Presentation only.
 */
interface HealthModel {
  readonly restrictions: readonly RestrictionView[];
  readonly earningPaused: boolean;
  readonly accountRestricted: boolean;
  readonly riderStatementKey: DriverStringKey;
}

export function healthModel(account: AccountState, compliance: DriverCompliance): HealthModel {
  const driverSide = driverSideRestrictions(compliance.restrictions);
  const accountRestricted = riderUseRestricted(account.restrictions) || riderUseRestricted(compliance.restrictions);
  return {
    restrictions: driverSide.map(restrictionView),
    earningPaused: driverSide.some((r) => r.scope === 'DRIVER_ROLE'),
    accountRestricted,
    riderStatementKey: accountRestricted ? 'drive.accountRestricted' : 'drive.health.riderUnaffected',
  };
}
