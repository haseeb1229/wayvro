import type { AccountState, DriverCompliance } from '@wayvro/contracts';
import type { DriverStringKey } from '../i18n/driver-strings';
import { eligibilitySummary } from './eligibility';
import type { RowMark } from './marks';

/**
 * Driver/Partner readiness shell `/drive` (K19 approved/expired/suspended surfacing, A07 informational; UX doc §10.1).
 * Built only from the SERVER's account state and `GET /v1/driver/compliance` (incl. its per-product eligibility); the
 * location row only READS the foreground permission (no request in the Driver/Partner area in Phase 3). There is no
 * "Go online" — driving opens in a later phase and nothing here promises a date. When compliance cannot be loaded, the
 * profile row falls back to the account state and the other rows say so (partial state) — nothing is guessed.
 *
 * "Suspended" (K19) is a DRIVER_ROLE restriction: earning is paused, rider use is NOT affected (V13). Only an
 * ACCOUNT-scope restriction that affects rider use changes the rider statement. Presentation only — the server
 * re-authorises every driver and rider request.
 */
type ReadinessTarget =
  | { readonly kind: 'compliance' }
  | { readonly kind: 'renewal'; readonly documentId: string }
  | { readonly kind: 'route'; readonly pathname: '/drive/eligibility' | '/drive/health' | '/drive/location' };

export interface ReadinessRow {
  readonly id: 'profile' | 'documents' | 'eligibility' | 'restrictions' | 'location';
  readonly mark: RowMark;
  readonly key: DriverStringKey;
  /** Count shown in the row text ({count}), or null. */
  readonly count: number | null;
  /** Server profile state copy key ({state}), or null. */
  readonly stateKey: DriverStringKey | null;
  readonly target: ReadinessTarget;
}

/** `ready` only when every row is decided and nothing needs attention; `unknown` while something could not be loaded. */
export type ReadinessHeadline = 'ready' | 'attention' | 'unknown';

export interface ReadinessModel {
  readonly rows: readonly ReadinessRow[];
  readonly headline: ReadinessHeadline;
  /** Compliance could not be loaded: documents/eligibility/restriction rows are unavailable (retry offered). */
  readonly partial: boolean;
  /** A DRIVER_ROLE restriction is in force: earning is paused (rider use unaffected unless `accountRestricted`). */
  readonly earningPaused: boolean;
  /** An ACCOUNT-scope restriction affecting rider use exists (rider use IS affected then). */
  readonly accountRestricted: boolean;
}

export type LocationReadiness = 'allowed' | 'not-yet' | 'unknown';

type Restriction = AccountState['restrictions'][number];

/** Restrictions on the Driver/Partner side only (DRIVER_ROLE, VEHICLE, SERVICE_CAPABILITY, CITY_CATEGORY). */
export const driverSideRestrictions = (restrictions: readonly Restriction[]): readonly Restriction[] => restrictions.filter((r) => r.scope !== 'ACCOUNT');

/** V13: only an ACCOUNT-scope restriction that the server marks as affecting rider use blocks Rider mode. */
export const riderUseRestricted = (restrictions: readonly Restriction[]): boolean => restrictions.some((r) => r.scope === 'ACCOUNT' && r.affectsRiderUse);

function documentsRow(compliance: DriverCompliance): ReadinessRow {
  const current = compliance.documents.filter((d) => d.status !== 'SUPERSEDED');
  const expired = current.filter((d) => d.status === 'EXPIRED');
  const due = current.filter((d) => d.renewalDue && d.status !== 'EXPIRED');
  const first = expired[0] ?? due[0];
  if (expired.length > 0 && first !== undefined)
    return {
      id: 'documents',
      mark: 'blocked',
      key: 'drive.row.documentsExpired',
      count: expired.length,
      stateKey: null,
      target: { kind: 'renewal', documentId: first.id },
    };
  if (due.length > 0 && first !== undefined)
    return {
      id: 'documents',
      mark: 'attention',
      key: 'drive.row.documentsDue',
      count: due.length,
      stateKey: null,
      target: { kind: 'renewal', documentId: first.id },
    };
  // submitted, under review or not accepted: never reported as "all valid"
  const notValid = current.filter((d) => d.status !== 'VALID').length;
  if (notValid > 0)
    return { id: 'documents', mark: 'attention', key: 'drive.row.documentsNotValid', count: notValid, stateKey: null, target: { kind: 'compliance' } };
  return { id: 'documents', mark: 'ok', key: 'drive.row.documentsValid', count: null, stateKey: null, target: { kind: 'compliance' } };
}

function eligibilityRow(compliance: DriverCompliance | null): ReadinessRow {
  const row = (mark: RowMark, key: DriverStringKey, count: number | null = null): ReadinessRow => ({
    id: 'eligibility',
    mark,
    key,
    count,
    stateKey: null,
    target: { kind: 'route', pathname: '/drive/eligibility' },
  });
  if (compliance === null) return row('info', 'drive.row.eligibilityUnavailable');
  const summary = eligibilitySummary(compliance);
  switch (summary.kind) {
    case 'unavailable':
      return row('info', 'drive.row.eligibilityUnavailable');
    case 'no-vehicle':
      return row('attention', 'drive.row.noVehicle');
    case 'eligible':
      return row('ok', 'drive.row.eligibleProducts', summary.count);
    case 'missing':
      return row('attention', 'drive.row.eligibilityMissing', summary.count);
    case 'not-eligible':
      return row('blocked', 'drive.row.notEligible');
  }
}

function restrictionsRow(driverSide: readonly Restriction[]): ReadinessRow {
  const target = { kind: 'route', pathname: '/drive/health' } as const;
  if (driverSide.length === 0) return { id: 'restrictions', mark: 'ok', key: 'drive.row.noRestrictions', count: null, stateKey: null, target };
  const paused = driverSide.some((r) => r.scope === 'DRIVER_ROLE');
  return {
    id: 'restrictions',
    mark: 'blocked',
    key: paused ? 'drive.row.earningPaused' : 'drive.row.restricted',
    count: driverSide.length,
    stateKey: null,
    target,
  };
}

export function readinessModel(account: AccountState, compliance: DriverCompliance | null, location: LocationReadiness): ReadinessModel {
  const profileState = compliance?.profile.state ?? account.driver.profile?.state ?? null;
  const profileRow: ReadinessRow =
    profileState === null
      ? { id: 'profile', mark: 'info', key: 'drive.row.profileUnknown', count: null, stateKey: null, target: { kind: 'compliance' } }
      : {
          id: 'profile',
          mark: profileState === 'ACTIVE_ELIGIBLE' || profileState === 'VERIFIED' ? 'ok' : 'attention',
          key: 'drive.row.profile',
          count: null,
          stateKey: `profileState.${profileState}`,
          target: { kind: 'compliance' },
        };
  // the compliance view is the fuller server list (vehicle/capability restrictions); the account state is the fallback
  const driverSide = driverSideRestrictions(compliance?.restrictions ?? account.restrictions);
  const rows: ReadinessRow[] = [
    profileRow,
    compliance === null
      ? { id: 'documents', mark: 'info', key: 'drive.row.unavailable', count: null, stateKey: null, target: { kind: 'compliance' } }
      : documentsRow(compliance),
    eligibilityRow(compliance),
    restrictionsRow(driverSide),
    {
      id: 'location',
      mark: 'info',
      key: location === 'allowed' ? 'drive.row.locationAllowed' : 'drive.row.locationLater',
      count: null,
      stateKey: null,
      target: { kind: 'route', pathname: '/drive/location' },
    },
  ];
  const accountRestricted = riderUseRestricted(account.restrictions) || riderUseRestricted(compliance?.restrictions ?? []);
  const undecided = compliance === null || rows.some((r) => r.key === 'drive.row.eligibilityUnavailable' || r.key === 'drive.row.profileUnknown');
  const needsAttention = accountRestricted || rows.some((r) => r.mark === 'attention' || r.mark === 'blocked');
  return {
    rows,
    headline: needsAttention ? 'attention' : undecided ? 'unknown' : 'ready',
    partial: compliance === null,
    earningPaused: driverSide.some((r) => r.scope === 'DRIVER_ROLE'),
    accountRestricted,
  };
}
