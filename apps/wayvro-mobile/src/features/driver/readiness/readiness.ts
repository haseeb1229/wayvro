import type { AccountState, DriverCompliance } from '@wayvro/contracts';
import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Driver/Partner readiness shell `/drive` (K19 approved/expired/suspended surfacing, A07 informational; UX doc §10.1).
 * Built only from the SERVER's account state and `GET /v1/driver/compliance`; the location row only READS the
 * foreground permission (no request in the Driver/Partner area in Phase 3). There is no "Go online" — driving opens in
 * a later phase and nothing here promises a date. When compliance cannot be loaded, the profile row falls back to the
 * account state and the other rows say so (partial state) — nothing is guessed.
 */
export type RowMark = 'ok' | 'attention' | 'blocked' | 'info';

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

export interface ReadinessModel {
  readonly rows: readonly ReadinessRow[];
  /** Compliance could not be loaded: documents/eligibility/restriction rows are unavailable (retry offered). */
  readonly partial: boolean;
  /** An ACCOUNT-scope restriction affecting rider use exists (rider use IS affected then). */
  readonly accountRestricted: boolean;
}

export type LocationReadiness = 'allowed' | 'not-yet' | 'unknown';

const MARK_GLYPH: Readonly<Record<RowMark, string>> = { ok: '✓', attention: '!', blocked: '✕', info: 'i' };
export const markGlyph = (mark: RowMark): string => MARK_GLYPH[mark];

const MARK_KEY: Readonly<Record<RowMark, DriverStringKey>> = {
  ok: 'drive.mark.ok',
  attention: 'drive.mark.attention',
  blocked: 'drive.mark.blocked',
  info: 'drive.mark.info',
};
export const markKey = (mark: RowMark): DriverStringKey => MARK_KEY[mark];

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
  return { id: 'documents', mark: 'ok', key: 'drive.row.documentsValid', count: null, stateKey: null, target: { kind: 'compliance' } };
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
  const driverRestrictions = compliance?.restrictions.length ?? account.restrictions.filter((r) => r.scope !== 'ACCOUNT').length;
  const restrictionsRow: ReadinessRow =
    driverRestrictions > 0
      ? {
          id: 'restrictions',
          mark: 'blocked',
          key: 'drive.row.restricted',
          count: driverRestrictions,
          stateKey: null,
          target: { kind: 'route', pathname: '/drive/health' },
        }
      : { id: 'restrictions', mark: 'ok', key: 'drive.row.noRestrictions', count: null, stateKey: null, target: { kind: 'route', pathname: '/drive/health' } };
  const rows: ReadinessRow[] = [profileRow];
  if (compliance === null)
    rows.push({ id: 'documents', mark: 'info', key: 'drive.row.unavailable', count: null, stateKey: null, target: { kind: 'compliance' } });
  else rows.push(documentsRow(compliance));
  rows.push({
    id: 'eligibility',
    mark: 'info',
    key: 'drive.row.eligibility',
    count: null,
    stateKey: null,
    target: { kind: 'route', pathname: '/drive/eligibility' },
  });
  rows.push(restrictionsRow);
  rows.push({
    id: 'location',
    mark: 'info',
    key: location === 'allowed' ? 'drive.row.locationAllowed' : 'drive.row.locationLater',
    count: null,
    stateKey: null,
    target: { kind: 'route', pathname: '/drive/location' },
  });
  return {
    rows,
    partial: compliance === null,
    accountRestricted: account.restrictions.some((r) => r.scope === 'ACCOUNT' && r.affectsRiderUse),
  };
}
