import { APPLICATION_STATE_VALUES, REVIEW_REASON_CATALOGUE, type AccountState, type DriverApplication } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { application, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';
import { CLOSED_STATES, EDITABLE_STATES, hubView, reasonItems, statusModel } from './status';

const driver = (overrides: Partial<AccountState['driver']> = {}): AccountState['driver'] => ({
  application: { id: DRIVER_IDS.application, state: 'DRAFT' },
  profile: null,
  onboardingAvailable: true,
  ...overrides,
});

type Decision = NonNullable<NonNullable<DriverApplication['review']>['latestDecision']>;
const reviewed = (
  state: DriverApplication['state'],
  decision: Partial<Decision> | null,
  extra: { inPersonRequired?: boolean; openAppealId?: string | null } = {},
) =>
  application({
    state,
    submittedAt: '2026-10-05T09:00:00.000Z',
    review: {
      latestDecision:
        decision === null
          ? null
          : { decisionId: DRIVER_IDS.decision, decision: 'REJECT', reasonCodes: [], decidedAt: '2026-10-06T09:00:00.000Z', appealable: true, ...decision },
      inPersonRequired: extra.inPersonRequired ?? false,
      openAppealId: extra.openAppealId ?? null,
    },
  });

describe('hub routing from server state', () => {
  it('no application: explanation when onboarding is available, otherwise "not available"', () => {
    expect(hubView(driver({ application: null }), null)).toEqual({ kind: 'intro' });
    expect(hubView(driver({ application: null, onboardingAvailable: false }), null)).toEqual({ kind: 'unavailable' });
  });

  it('a driver profile always opens the compliance view (verified driver)', () => {
    expect(hubView(driver({ profile: { id: DRIVER_IDS.profile, state: 'VERIFIED' } }), application({ state: 'VERIFIED' }))).toEqual({ kind: 'compliance' });
  });

  it('maps EVERY application state to exactly one view', () => {
    for (const state of APPLICATION_STATE_VALUES) {
      const view = hubView(driver(), application({ state }));
      if (state === 'DRAFT') expect(view.kind).toBe('consent');
      else if (EDITABLE_STATES.has(state)) expect(view.kind).toBe('overview');
      else expect(view.kind).toBe('status');
      if (view.kind === 'status') {
        expect(DRIVER_CATALOGUE.en[view.status.titleKey]).toBeTruthy();
        expect(DRIVER_CATALOGUE.en[view.status.bodyKey]).toBeTruthy();
      }
    }
    // Every state is either editable, DRAFT, VERIFIED (renewals keep using the application) or closed.
    for (const state of APPLICATION_STATE_VALUES)
      expect(EDITABLE_STATES.has(state) || state === 'DRAFT' || state === 'VERIFIED' || CLOSED_STATES.has(state)).toBe(true);
    expect(CLOSED_STATES.has('VERIFIED')).toBe(false);
  });

  it('NEEDS_INFO shows each reviewer reason and lets the applicant fix and resubmit', () => {
    const view = hubView(
      driver(),
      reviewed('NEEDS_INFO', { decision: 'NEEDS_INFO', reasonCodes: ['CNIC_IMAGE_UNREADABLE', 'NAME_MISMATCH'], appealable: false }),
    );
    expect(view).toMatchObject({
      kind: 'overview',
      needsInfo: [
        { code: 'CNIC_IMAGE_UNREADABLE', key: 'reason.CNIC_IMAGE_UNREADABLE' },
        { code: 'NAME_MISMATCH', key: 'reason.NAME_MISMATCH' },
      ],
    });
  });
});

describe('status for review states and decisions', () => {
  it('submitted and auto-check states say a person reviews; manual review likewise', () => {
    expect(statusModel(application({ state: 'SUBMITTED' }), true).titleKey).toBe('status.received.title');
    expect(statusModel(application({ state: 'AUTO_CHECK_PENDING' }), true).titleKey).toBe('status.received.title');
    expect(statusModel(application({ state: 'MANUAL_REVIEW' }), true).titleKey).toBe('status.inReview.title');
  });

  it('REJECTED and appealable: reasons, decision date and an appeal action on that decision', () => {
    const model = statusModel(reviewed('REJECTED', { reasonCodes: ['LICENCE_INVALID'] }), true);
    expect(model).toMatchObject({ titleKey: 'status.rejected.title', bodyKey: 'status.rejected.body', tone: 'error', appealDecisionId: DRIVER_IDS.decision });
    expect(model.actions).toContain('appeal');
    expect(model.reasons).toEqual([{ code: 'LICENCE_INVALID', key: 'reason.LICENCE_INVALID' }]);
    expect(model.decidedAt).toBe('2026-10-06T09:00:00.000Z');
  });

  it('REJECTED without appeal (not appealable, or an appeal already open) offers no appeal', () => {
    for (const app of [reviewed('REJECTED', { appealable: false }), reviewed('REJECTED', {}, { openAppealId: DRIVER_IDS.appeal })]) {
      const model = statusModel(app, true);
      expect(model.actions).not.toContain('appeal');
      expect(model.appealDecisionId).toBeNull();
      expect(model.bodyKey).toBe('status.rejected.bodyNoAppeal');
    }
  });

  it('APPEALED, REJECTED_FINAL (honest, support placeholder), VERIFIED', () => {
    expect(statusModel(application({ state: 'APPEALED' }), true).titleKey).toBe('status.appealed.title');
    const final = statusModel(reviewed('REJECTED_FINAL', { reasonCodes: ['DOCUMENT_FORGERY_SUSPECTED'] }), true);
    expect(final).toMatchObject({ titleKey: 'status.final.title', supportNote: true, actions: [] });
    expect(statusModel(application({ state: 'VERIFIED' }), true).actions).toContain('compliance');
  });

  it('in-person verification required (flag or decision) shows the pending-process status', () => {
    expect(statusModel(reviewed('MANUAL_REVIEW', null, { inPersonRequired: true }), true).titleKey).toBe('status.inPerson.title');
    const decided = statusModel(reviewed('MANUAL_REVIEW', { decision: 'REQUIRE_IN_PERSON', reasonCodes: ['ACCESSIBILITY_ALTERNATIVE'] }), true);
    expect(decided).toMatchObject({
      titleKey: 'status.inPerson.title',
      reasons: [{ code: 'ACCESSIBILITY_ALTERNATIVE', key: 'reason.ACCESSIBILITY_ALTERNATIVE' }],
    });
  });

  it('withdrawn/expired offer a new application only while onboarding is available', () => {
    expect(statusModel(application({ state: 'WITHDRAWN' }), true).actions).toEqual(['start-again']);
    expect(statusModel(application({ state: 'EXPIRED_DRAFT' }), false).actions).toEqual([]);
  });

  it('every catalogued review reason has copy; unknown codes are shown as a reference only', () => {
    for (const code of Object.values(REVIEW_REASON_CATALOGUE).flat()) {
      const [item] = reasonItems([code]);
      expect(item?.key, code).not.toBeNull();
      if (item?.key) expect(DRIVER_CATALOGUE.en[item.key]).toBeTruthy();
    }
    expect(reasonItems(['SOMETHING_NEW'])).toEqual([{ code: 'SOMETHING_NEW', key: null }]);
  });
});
