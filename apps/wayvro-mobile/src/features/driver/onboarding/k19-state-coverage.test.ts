import {
  APPLICATION_STATE_VALUES,
  EVIDENCE_KIND_VALUES,
  LOCALES,
  PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES,
  PRODUCT_ELIGIBILITY_REASONS,
  PRODUCT_ELIGIBILITY_RESULTS,
  REASON_CLASS_VALUES,
  RESTRICTION_SCOPE_VALUES,
  type AccountState,
  type DriverApplication,
  type DriverCompliance,
} from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { application, compliance, doc, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { p3Account } from '../../../__mocks__/p3-fixtures';
import { deriveModes } from '../../../core/mode/availability';
import { captureGuidance } from '../capture/capture-rules';
import { complianceModel } from '../compliance/compliance';
import { DRIVER_CATALOGUE, type DriverStringKey } from '../i18n/driver-strings';
import { missingItem, reasonItem, resultKey } from '../readiness/eligibility';
import { healthModel } from '../readiness/health';
import { markKey } from '../readiness/marks';
import { readinessModel } from '../readiness/readiness';
import { createUploadItem, nextUploadAction, reduceUpload, type FailureReason, type UploadEvent, type UploadItem } from '../upload/upload-queue';
import { evidenceDisplay } from './checklist';
import { hubView } from './status';

/**
 * K19 onboarding state coverage (UX doc §10.5): every server state the Driver/Partner area can meet — application
 * state, profile state, document status, restriction scope and reason class, upload-queue state and failure, product
 * eligibility result — maps through the PRODUCTION view adapters to a view state and a copy key that exists, non-empty,
 * in en, ur and ur-Latn. A state without copy (or a new contract value without a row here) fails this test.
 */
type K19 = 'pending' | 'failed' | 'review' | 'approved' | 'rejected' | 'expired' | 'suspended' | 'withdrawn';

const hasCopy = (key: DriverStringKey): void => {
  for (const locale of LOCALES)
    expect(Object.prototype.hasOwnProperty.call(DRIVER_CATALOGUE[locale], key) && DRIVER_CATALOGUE[locale][key].trim() !== '', `${locale}:${key}`).toBe(true);
};

const driverSection = (app: DriverApplication | null, profile: AccountState['driver']['profile'] = null): AccountState['driver'] => ({
  application: app === null ? null : { id: app.id, state: app.state },
  profile,
  onboardingAvailable: true,
});

// ── application states ─────────────────────────────────────────────────────────────────────────────────────────

type ApplicationState = DriverApplication['state'];
/** Expected K19 bucket and hub view per application state (exhaustive: a new state fails to compile). */
const APPLICATION_TABLE: Readonly<Record<ApplicationState, { readonly k19: K19; readonly view: 'consent' | 'overview' | 'status' }>> = {
  DRAFT: { k19: 'pending', view: 'consent' },
  CONSENTED: { k19: 'pending', view: 'overview' },
  DOCUMENTS_PENDING: { k19: 'pending', view: 'overview' },
  NEEDS_INFO: { k19: 'failed', view: 'overview' },
  SUBMITTED: { k19: 'review', view: 'status' },
  AUTO_CHECK_PENDING: { k19: 'review', view: 'status' },
  MANUAL_REVIEW: { k19: 'review', view: 'status' },
  REJECTED: { k19: 'rejected', view: 'status' },
  APPEALED: { k19: 'rejected', view: 'status' },
  REJECTED_FINAL: { k19: 'rejected', view: 'status' },
  VERIFIED: { k19: 'approved', view: 'status' },
  WITHDRAWN: { k19: 'withdrawn', view: 'status' },
  EXPIRED_DRAFT: { k19: 'expired', view: 'status' },
};

/** The headline copy the hub shows for an application view (consent/overview/status). */
function applicationCopy(app: DriverApplication): { readonly view: string; readonly keys: readonly DriverStringKey[] } {
  const view = hubView(driverSection(app), app);
  switch (view.kind) {
    case 'consent':
      return { view: view.kind, keys: ['explain.title', 'explain.consentTitle'] };
    case 'overview':
      return { view: view.kind, keys: view.needsInfo === null ? ['overview.title', 'overview.body'] : ['overview.needsInfoTitle', 'overview.needsInfoBody'] };
    case 'status':
      return { view: view.kind, keys: [view.status.titleKey, view.status.bodyKey] };
    case 'intro':
    case 'unavailable':
    case 'compliance':
      return { view: view.kind, keys: [] };
  }
}

describe('K19 — application states → view + copy', () => {
  it('the table covers every contract application state', () => {
    expect(Object.keys(APPLICATION_TABLE).sort()).toEqual([...APPLICATION_STATE_VALUES].sort());
  });

  for (const state of APPLICATION_STATE_VALUES) {
    it(`${state} → ${APPLICATION_TABLE[state].k19} (${APPLICATION_TABLE[state].view}) with copy in every locale`, () => {
      const decision =
        state === 'NEEDS_INFO' || state === 'REJECTED' || state === 'REJECTED_FINAL'
          ? {
              decisionId: DRIVER_IDS.decision,
              decision: state === 'NEEDS_INFO' ? ('NEEDS_INFO' as const) : ('REJECT' as const),
              reasonCodes: ['CNIC_IMAGE_UNREADABLE'],
              decidedAt: '2026-10-05T10:00:00.000Z',
              appealable: true,
            }
          : null;
      const app = application({ state, review: { latestDecision: decision, inPersonRequired: false, openAppealId: null } });
      const copy = applicationCopy(app);
      expect(copy.view).toBe(APPLICATION_TABLE[state].view);
      expect(copy.keys.length).toBeGreaterThan(0);
      copy.keys.forEach(hasCopy);
      if (state === 'NEEDS_INFO') expect(copy.keys).toContain('overview.needsInfoTitle');
    });
  }

  it('in-person review is its own review copy; a verified driver PROFILE always opens the compliance view', () => {
    const inPerson = application({ state: 'MANUAL_REVIEW', review: { latestDecision: null, inPersonRequired: true, openAppealId: null } });
    expect(applicationCopy(inPerson).keys).toEqual(['status.inPerson.title', 'status.inPerson.body']);
    const verified = application({ state: 'VERIFIED' });
    expect(hubView(driverSection(verified, { id: DRIVER_IDS.profile, state: 'VERIFIED' }), verified).kind).toBe('compliance');
  });
});

// ── profile states and documents ───────────────────────────────────────────────────────────────────────────────

type ProfileState = DriverCompliance['profile']['state'];
const PROFILE_TABLE: Readonly<Record<ProfileState, { readonly k19: K19; readonly mark: 'ok' | 'attention' }>> = {
  VERIFIED: { k19: 'approved', mark: 'ok' },
  ACTIVE_ELIGIBLE: { k19: 'approved', mark: 'ok' },
  EXPIRED: { k19: 'expired', mark: 'attention' },
  REVERIFY_DUE: { k19: 'expired', mark: 'attention' },
};

type DocumentStatus = DriverCompliance['documents'][number]['status'];
const DOCUMENT_TABLE: Readonly<Record<DocumentStatus, { readonly shown: boolean; readonly readinessKey: DriverStringKey }>> = {
  SUBMITTED: { shown: true, readinessKey: 'drive.row.documentsNotValid' },
  UNDER_REVIEW: { shown: true, readinessKey: 'drive.row.documentsNotValid' },
  VALID: { shown: true, readinessKey: 'drive.row.documentsValid' },
  REJECTED: { shown: true, readinessKey: 'drive.row.documentsNotValid' },
  EXPIRED: { shown: true, readinessKey: 'drive.row.documentsExpired' },
  SUPERSEDED: { shown: false, readinessKey: 'drive.row.documentsValid' },
};

describe('K19 — profile states and document statuses → readiness + copy', () => {
  for (const state of Object.keys(PROFILE_TABLE) as ProfileState[]) {
    it(`profile ${state} → ${PROFILE_TABLE[state].k19}: readiness mark ${PROFILE_TABLE[state].mark}, copy profileState.${state}`, () => {
      const row = readinessModel(p3Account('B'), compliance({ profile: { id: DRIVER_IDS.profile, state } }), 'not-yet').rows[0];
      expect(row).toMatchObject({ id: 'profile', mark: PROFILE_TABLE[state].mark, stateKey: `profileState.${state}` });
      hasCopy(`profileState.${state}`);
      hasCopy(markKey(PROFILE_TABLE[state].mark));
    });
  }

  for (const status of Object.keys(DOCUMENT_TABLE) as DocumentStatus[]) {
    it(`document ${status} → docStatus copy and the readiness documents row`, () => {
      const document = {
        ...doc(DRIVER_IDS.licenceDoc, 'DRIVING_LICENCE', status),
        expiresOn: '2026-09-01',
        renewalDue: false,
        hasNumber: true,
        hasExpiry: true,
      };
      const c = compliance({ documents: [document] });
      const rows = complianceModel(c).documents;
      expect(rows.length).toBe(DOCUMENT_TABLE[status].shown ? 1 : 0);
      if (rows[0]) hasCopy(rows[0].statusKey);
      const docRow = readinessModel(p3Account('B'), c, 'not-yet').rows.find((r) => r.id === 'documents');
      expect(docRow?.key).toBe(DOCUMENT_TABLE[status].readinessKey);
      if (docRow) hasCopy(docRow.key);
    });
  }

  it('expiring soon needs attention and links to the renewal (K19 expired surfacing)', () => {
    const due = { ...doc(DRIVER_IDS.licenceDoc, 'DRIVING_LICENCE', 'VALID'), expiresOn: '2026-10-20', renewalDue: true, hasNumber: true, hasExpiry: true };
    expect(readinessModel(p3Account('B'), compliance({ documents: [due] }), 'not-yet').rows.find((r) => r.id === 'documents')).toMatchObject({
      mark: 'attention',
      key: 'drive.row.documentsDue',
      target: { kind: 'renewal', documentId: DRIVER_IDS.licenceDoc },
    });
  });
});

// ── restrictions: scopes, classes and the mode rules ───────────────────────────────────────────────────────────

type Scope = AccountState['restrictions'][number]['scope'];
const SCOPE_TABLE: Readonly<
  Record<
    Scope,
    { readonly k19: K19 | 'restricted' | 'account'; readonly earningPaused: boolean; readonly riderBlocked: boolean; readonly listedOnHealth: boolean }
  >
> = {
  ACCOUNT: { k19: 'account', earningPaused: false, riderBlocked: true, listedOnHealth: false },
  DRIVER_ROLE: { k19: 'suspended', earningPaused: true, riderBlocked: false, listedOnHealth: true },
  VEHICLE: { k19: 'restricted', earningPaused: false, riderBlocked: false, listedOnHealth: true },
  SERVICE_CAPABILITY: { k19: 'restricted', earningPaused: false, riderBlocked: false, listedOnHealth: true },
  CITY_CATEGORY: { k19: 'restricted', earningPaused: false, riderBlocked: false, listedOnHealth: true },
};

const restriction = (scope: Scope): AccountState['restrictions'][number] => ({
  id: DRIVER_IDS.restriction,
  scope,
  reasonCode: 'SYNTHETIC_REASON',
  reasonClass: 'COMPLIANCE',
  appealable: true,
  effectiveUntil: null,
  affectsRiderUse: scope === 'ACCOUNT',
});

describe('K19 — restriction scopes → health/readiness + mode rules (V13)', () => {
  it('the table covers every contract restriction scope', () => {
    expect(Object.keys(SCOPE_TABLE).sort()).toEqual([...RESTRICTION_SCOPE_VALUES].sort());
  });

  for (const scope of RESTRICTION_SCOPE_VALUES) {
    const expected = SCOPE_TABLE[scope];
    it(`${scope} → ${expected.k19}: earning paused ${String(expected.earningPaused)}, rider blocked ${String(expected.riderBlocked)}`, () => {
      const r = restriction(scope);
      const account: AccountState = { ...p3Account('B'), restrictions: [r] };
      const c = compliance({ restrictions: [r] });
      const health = healthModel(account, c);
      expect(health.earningPaused).toBe(expected.earningPaused);
      expect(health.accountRestricted).toBe(expected.riderBlocked);
      expect(health.restrictions.length).toBe(expected.listedOnHealth ? 1 : 0);
      expect(health.riderStatementKey).toBe(expected.riderBlocked ? 'drive.accountRestricted' : 'drive.health.riderUnaffected');
      hasCopy(health.riderStatementKey);
      hasCopy(`driverRestriction.scope.${scope}`);
      for (const v of health.restrictions) {
        hasCopy(v.key);
        hasCopy(v.scopeKey);
      }
      // readiness: driver-side scopes block the restrictions row; "suspended" reads "earning paused"
      const readiness = readinessModel(account, c, 'not-yet');
      expect(readiness.earningPaused).toBe(expected.earningPaused);
      expect(readiness.accountRestricted).toBe(expected.riderBlocked);
      const row = readiness.rows.find((x) => x.id === 'restrictions');
      expect(row?.key).toBe(expected.earningPaused ? 'drive.row.earningPaused' : expected.listedOnHealth ? 'drive.row.restricted' : 'drive.row.noRestrictions');
      if (row) hasCopy(row.key);
      if (expected.earningPaused) hasCopy('drive.health.paused');
      // mode rules: a driver-side restriction NEVER blocks Rider mode; an account-wide one blocks both
      const modes = deriveModes(account);
      expect(modes.rider.available).toBe(!expected.riderBlocked);
      if (expected.riderBlocked) expect(modes.driver.blockers).toContain('ACCOUNT_RESTRICTED');
      if (expected.earningPaused) expect(modes.driver.blockers).toContain('ROLE_RESTRICTED');
      expect(modes.driver.entry).toBe('HUB');
    });
  }

  it('every restriction reason class has copy', () => {
    for (const reasonClass of REASON_CLASS_VALUES) hasCopy(`driverRestriction.${reasonClass}`);
  });

  it('an ACCOUNT restriction that does NOT affect rider use leaves Rider mode open (server flag decides)', () => {
    const r = { ...restriction('ACCOUNT'), affectsRiderUse: false };
    const account: AccountState = { ...p3Account('B'), restrictions: [r] };
    expect(healthModel(account, compliance({ restrictions: [r] })).accountRestricted).toBe(false);
    expect(deriveModes(account).rider.available).toBe(true);
  });
});

// ── uploads: queue states, failures, offline resume, camera guidance ──────────────────────────────────────────

const NOW = 1_000_000;
const random = () => 0.5;
const run = (item: UploadItem, ...events: UploadEvent[]): UploadItem => events.reduce((acc, e) => reduceUpload(acc, e, NOW, random), item);
function queued(): UploadItem {
  const created = createUploadItem(
    {
      id: 'local_item_000001',
      applicationId: DRIVER_IDS.application,
      documentId: DRIVER_IDS.cnicDoc,
      kind: 'CNIC_FRONT',
      source: 'IN_APP_CAMERA',
      challengeId: null,
      fileName: 'synthetic_file_01.jpg',
      byteSize: 100,
      mime: 'image/jpeg',
    },
    [],
  );
  if (!created.ok) throw new Error(created.reason);
  return created.item;
}
const display = (item: UploadItem) => evidenceDisplay(DRIVER_IDS.cnicDoc, 'CNIC_FRONT', [], [item]);

const FAILURES: Readonly<Record<FailureReason, true>> = {
  offline: true,
  'rate-limited': true,
  'slot-expired': true,
  conflict: true,
  'file-missing': true,
  unavailable: true,
  unknown: true,
};

describe('K19 — upload states ("upload failed, will retry"), offline resume and camera guidance', () => {
  it('every display state of the queue has copy; every failure reason has copy', () => {
    const slot = run(queued(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 });
    const items = [
      queued(),
      slot,
      run(slot, { type: 'put-started' }),
      run(slot, { type: 'put-started' }, { type: 'put-succeeded' }),
      run(slot, { type: 'put-started' }, { type: 'put-succeeded' }, { type: 'server-status', status: 'PROCESSING', rejection: null }),
      run(queued(), { type: 'transient-error', reason: 'offline' }),
      run(queued(), { type: 'definitive-error', reason: 'conflict' }),
    ];
    const states = items.map((i) => display(i).state);
    expect(states).toEqual(['queued', 'queued', 'uploading', 'uploading', 'processing', 'retrying', 'failed']);
    for (const state of [...states, 'none', 'accepted', 'rejected'] as const) hasCopy(`evidence.state.${state}`);
    for (const reason of Object.keys(FAILURES) as FailureReason[]) hasCopy(`evidence.fail.${reason}`);
  });

  it('a transient failure shows "upload failed, will retry" (not a dead end) and retries on its own with bounded backoff', () => {
    const offline = run(queued(), { type: 'transient-error', reason: 'offline' });
    expect(display(offline)).toEqual({ state: 'retrying', localId: offline.id, failure: 'offline' });
    expect(DRIVER_CATALOGUE.en['evidence.state.retrying']).toMatch(/try again automatically/);
    expect(DRIVER_CATALOGUE.en['evidence.fail.offline']).toMatch(/keep trying/);
    // waits for its backoff, then asks for a slot again without user action
    expect(nextUploadAction(offline, NOW, false)).toEqual({ type: 'wait', until: offline.retryAt });
    expect(nextUploadAction(offline, (offline.retryAt ?? NOW) + 1, false)).toEqual({ type: 'request-slot' });
  });

  it('offline resume: back online, the same item continues to the server outcome; after a restart it asks the server first', () => {
    const offline = run(queued(), { type: 'transient-error', reason: 'offline' }, { type: 'transient-error', reason: 'offline' });
    const later = (offline.retryAt ?? NOW) + 1;
    const step = (item: UploadItem, e: UploadEvent) => reduceUpload(item, e, later, random);
    const slot = step(offline, { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 });
    expect(display(slot).state).toBe('queued');
    const online: readonly UploadEvent[] = [{ type: 'put-started' }, { type: 'put-succeeded' }, { type: 'server-status', status: 'ACCEPTED', rejection: null }];
    const accepted = online.reduce<UploadItem>(step, slot);
    expect(accepted.state).toBe('accepted');
    // restart while a slot was held: the URL was never stored, so the item confirms with the server instead of re-uploading
    const resumed = step(step(slot, { type: 'put-started' }), { type: 'resume' });
    expect(resumed.state).toBe('completing');
    expect(nextUploadAction(resumed, later, false)).toEqual({ type: 'complete', uploadId: DRIVER_IDS.upload1 });
  });

  it('camera guidance is plain text tips with copy for every evidence kind (selfie: manual-review note)', () => {
    for (const kind of EVIDENCE_KIND_VALUES) {
      const keys = captureGuidance(kind);
      expect(keys.length).toBe(3);
      keys.forEach(hasCopy);
    }
    expect(captureGuidance('SELFIE_FOR_MANUAL_REVIEW')).toEqual(['capture.guideFace', 'capture.guideLight', 'capture.selfieNote']);
    expect(captureGuidance('CNIC_FRONT')).toEqual(['capture.guideCard', 'capture.guideLight', 'capture.guideSteady']);
    expect(captureGuidance('DOCUMENT_PAGE')[0]).toBe('capture.guidePage');
  });
});

// ── per-product eligibility (H10 display) ──────────────────────────────────────────────────────────────────────

describe('K19/H10 — product eligibility results, reasons and missing attributes have copy', () => {
  it('every result, reason and missing attribute of the contract maps to copy; unknown codes are shown by reference', () => {
    for (const result of PRODUCT_ELIGIBILITY_RESULTS) hasCopy(resultKey(result));
    for (const code of PRODUCT_ELIGIBILITY_REASONS) {
      const item = reasonItem(code, true);
      expect(item.key, code).not.toBeNull();
      if (item.key) hasCopy(item.key);
    }
    for (const code of PRODUCT_ELIGIBILITY_MISSING_ATTRIBUTES) {
      const item = missingItem(code);
      expect(item.key, code).not.toBeNull();
      if (item.key) hasCopy(item.key);
    }
    expect(reasonItem('A_LATER_REASON', true).key).toBeNull();
    expect(missingItem('wheelbase').key).toBeNull();
    // the legal-gate copy names the city; without a known city it is shown by reference, never with a blank
    expect(reasonItem('DISABLED_LEGAL_GATE', false).key).toBeNull();
    expect(DRIVER_CATALOGUE.en['drive.eligibility.reason.DISABLED_LEGAL_GATE']).toBe('Not offered in {city} yet.');
  });
});
