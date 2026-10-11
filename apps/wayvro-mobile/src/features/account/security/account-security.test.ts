import { DELETION_BLOCKERS, DELETION_STATUSES, PHONE_CHANGE_STATUSES, type DeletionRequest, type PhoneChange } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, errorFromResponse } from '../../../core/api/errors';
import { CATALOGUE } from '../../../core/i18n/strings';
import {
  buildPhoneChange,
  buildRecoveryRequest,
  deletionView,
  guardedErrorView,
  humaniseCode,
  isStepUpRequired,
  phoneChangeNotice,
  phoneChangeRefusal,
  reduceGuarded,
  reviewView,
  stepUpSendError,
  type GuardedPhase,
} from './account-security';

const ID = '0190d000-0000-7000-8000-000000000001';
const stepUp = new ApiError('step-up-required', { code: 'WAYVRO_E_STEP_UP_REQUIRED', status: 403 });
const NOW = Date.parse('2026-10-11T10:00:00.000Z');

describe('step-up guarded actions', () => {
  const run = (...events: Parameters<typeof reduceGuarded>[1][]): GuardedPhase => events.reduce<GuardedPhase>(reduceGuarded, { kind: 'idle' });

  it('a "step-up required" refusal opens the confirmation; the retry needs the user to confirm and runs once', () => {
    expect(isStepUpRequired(stepUp)).toBe(true);
    expect(isStepUpRequired(new ApiError('conflict'))).toBe(false);
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp })).toEqual({ kind: 'step-up' });
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'stepped-up' })).toEqual({ kind: 'confirm-retry' });
    // Nothing is retried until the user confirms.
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'stepped-up' }, { type: 'start' }).kind).toBe('running');
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'stepped-up' }, { type: 'confirm' })).toEqual({ kind: 'running', retry: true });
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'stepped-up' }, { type: 'confirm' }, { type: 'succeeded' })).toEqual({
      kind: 'done',
    });
  });

  it('a second step-up refusal after the retry is final and explained', () => {
    const phase = run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'stepped-up' }, { type: 'confirm' }, { type: 'failed', error: stepUp });
    expect(phase).toEqual({ kind: 'failed', error: stepUp, afterStepUp: true });
    if (phase.kind === 'failed') expect(guardedErrorView(phase).messageKey).toBe('stepUp.failedAgain');
  });

  it('other failures are shown directly; cancel returns to idle; impossible events are ignored', () => {
    const offline = new ApiError('offline', { transient: true });
    const failed = run({ type: 'start' }, { type: 'failed', error: offline });
    expect(failed).toMatchObject({ kind: 'failed', afterStepUp: false });
    if (failed.kind === 'failed') expect(guardedErrorView(failed).messageKey).toBe('error.offline');
    expect(run({ type: 'start' }, { type: 'failed', error: stepUp }, { type: 'cancel' })).toEqual({ kind: 'idle' });
    expect(run({ type: 'confirm' })).toEqual({ kind: 'idle' });
    expect(run({ type: 'stepped-up' })).toEqual({ kind: 'idle' });
    expect(run({ type: 'start' }, { type: 'cancel' })).toEqual({ kind: 'running', retry: false });
  });

  it('a code that cannot be sent because delivery is down says so', () => {
    expect(stepUpSendError(new ApiError('unavailable', { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' })).messageKey).toBe('phone.otpUnavailable');
    expect(stepUpSendError(new ApiError('rate-limited', { retryAfterSeconds: 30 })).messageKey).toBe('error.rateLimited');
  });
});

describe('phone change', () => {
  it('checks the new number format on the device only', () => {
    expect(buildPhoneChange('+92 399 0000001')).toEqual({ ok: true, newPhone: '+923990000001' });
    expect(buildPhoneChange('0399-0000001')).toEqual({ ok: true, newPhone: '03990000001' });
    expect(buildPhoneChange('12345')).toEqual({ ok: false, errorKey: 'phone.invalid' });
  });

  it('every 409 except the new-device cooldown is the same generic refusal (no hint that the number is in use)', () => {
    const generic = phoneChangeRefusal(errorFromResponse(409, { error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'r' } }), NOW, 0);
    expect(generic).toEqual({ kind: 'message', view: { kind: 'conflict', messageKey: 'phoneChange.generic', action: 'none' } });
    const withOtherReason = phoneChangeRefusal(
      errorFromResponse(409, { error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'r', details: { reasonCodes: ['PHONE_IN_USE'] } } }),
      NOW,
      0,
    );
    expect(withOtherReason).toEqual(generic);
  });

  it('the new-device cooldown shows from when a change is possible (server time)', () => {
    const cooldown = errorFromResponse(409, {
      error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'r', details: { reasonCodes: ['NEW_DEVICE_COOLDOWN'], retryAfterSeconds: 3600 } },
    });
    expect(phoneChangeRefusal(cooldown, NOW, 60_000)).toEqual({ kind: 'cooldown', availableAt: '2026-10-11T11:01:00.000Z' });
    const noTime = errorFromResponse(409, {
      error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'r', details: { reasonCodes: ['NEW_DEVICE_COOLDOWN'] } },
    });
    expect(phoneChangeRefusal(noTime, NOW, 0)).toEqual({ kind: 'cooldown', availableAt: null });
  });

  it('step-up, invalid number and delivery outages have their own outcomes', () => {
    expect(phoneChangeRefusal(stepUp, NOW, 0)).toEqual({ kind: 'step-up' });
    expect(phoneChangeRefusal(new ApiError('validation', { code: 'WAYVRO_E_VALIDATION' }), NOW, 0)).toMatchObject({ view: { messageKey: 'phone.invalid' } });
    expect(phoneChangeRefusal(new ApiError('unavailable', { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' }), NOW, 0)).toMatchObject({
      view: { messageKey: 'phone.otpUnavailable' },
    });
  });
});

describe('"This wasn\'t me" notice', () => {
  const change = (overrides: Partial<PhoneChange>): PhoneChange => ({
    id: ID,
    kind: 'SELF_SERVICE',
    status: 'CURRENT_PHONE_VERIFIED',
    maskedNewPhone: '+92 3** *** **01',
    cooldownUntil: null,
    createdAt: '2026-10-11T09:00:00.000Z',
    ...overrides,
  });

  it('is shown for every open request (any kind) and hidden for finished ones', () => {
    const open = new Set(['CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN']);
    for (const status of PHONE_CHANGE_STATUSES) expect(phoneChangeNotice(change({ status })) !== null, status).toBe(open.has(status));
    expect(phoneChangeNotice(null)).toBeNull();
  });

  it('names the kind, the masked number and the cooldown end', () => {
    expect(phoneChangeNotice(change({}))).toMatchObject({
      kindKey: 'phoneNotice.change',
      maskedNewPhone: '+92 3** *** **01',
      cooldownUntil: null,
      inReview: false,
    });
    expect(phoneChangeNotice(change({ kind: 'RECOVERY_DRIVER_KYC', status: 'COOLDOWN', cooldownUntil: '2026-10-14T09:00:00.000Z' }))).toMatchObject({
      kindKey: 'phoneNotice.recovery',
      cooldownUntil: '2026-10-14T09:00:00.000Z',
    });
    expect(phoneChangeNotice(change({ status: 'MANUAL_REVIEW' }))?.inReview).toBe(true);
  });
});

describe('lost-phone recovery request', () => {
  it('only Driver/Partner document proof is available; the old number is format-checked', () => {
    expect(buildRecoveryRequest('03990000001', 'DRIVER_KYC')).toEqual({ ok: true, previousPhone: '03990000001', proof: 'DRIVER_KYC' });
    expect(buildRecoveryRequest('03990000001', 'LINKED_OIDC')).toEqual({ ok: false, errorKey: 'lostPhone.proofUnavailable' });
    expect(buildRecoveryRequest('abc', 'DRIVER_KYC')).toEqual({ ok: false, errorKey: 'phone.invalid' });
  });
});

describe('dormant-number review', () => {
  const review = (status: 'PENDING' | 'IN_REVIEW' | 'RESOLVED_OWNER' | 'RESOLVED_NEW_ACCOUNT' | 'DENIED', choices: ('I_AM_NEW' | 'THIS_IS_MY_ACCOUNT')[]) => ({
    id: ID,
    status,
    choices,
  });

  it('offers only the choices the server lists', () => {
    expect(reviewView(review('PENDING', ['I_AM_NEW']))).toEqual({ kind: 'choose', id: ID, canStartNew: true, canClaim: false });
    expect(reviewView(review('PENDING', ['I_AM_NEW', 'THIS_IS_MY_ACCOUNT']))).toEqual({ kind: 'choose', id: ID, canStartNew: true, canClaim: true });
    expect(reviewView(review('IN_REVIEW', ['I_AM_NEW']))).toEqual({ kind: 'in-review', id: ID, canStartNew: true });
    expect(reviewView(review('IN_REVIEW', []))).toEqual({ kind: 'in-review', id: ID, canStartNew: false });
    expect(reviewView(review('DENIED', ['I_AM_NEW']))).toEqual({ kind: 'denied', id: ID, canStartNew: true });
    expect(reviewView(review('RESOLVED_OWNER', []))).toEqual({ kind: 'resolved' });
    expect(reviewView(review('RESOLVED_NEW_ACCOUNT', []))).toEqual({ kind: 'resolved' });
    expect(reviewView(null)).toEqual({ kind: 'none' });
  });
});

describe('deletion', () => {
  const request = (overrides: Partial<DeletionRequest>): DeletionRequest => ({
    id: ID,
    status: 'GRACE',
    channel: 'APP',
    graceUntil: '2026-10-25T10:00:00.000Z',
    blockers: [],
    retained: [{ dataCategory: 'TRIP_RECORDS', basisRef: 'PLACEHOLDER_TAX_RECORDS' }],
    createdAt: '2026-10-11T10:00:00.000Z',
    ...overrides,
  });

  it('shows status, grace end, explicit blockers and the retained list; cancel only while it can still stop', () => {
    expect(deletionView(request({}))).toEqual({
      kind: 'open',
      id: ID,
      statusKey: 'deletion.status.GRACE',
      graceUntil: '2026-10-25T10:00:00.000Z',
      blockerKeys: [],
      retained: [{ category: 'trip records', basis: 'placeholder tax records' }],
      canCancel: true,
    });
    expect(deletionView(request({ status: 'BLOCKED', blockers: ['LEGAL_HOLD', 'OPEN_SAFETY_OR_FRAUD_INVESTIGATION'] }))).toMatchObject({
      blockerKeys: ['deletion.blocker.LEGAL_HOLD', 'deletion.blocker.OPEN_SAFETY_OR_FRAUD_INVESTIGATION'],
      canCancel: true,
    });
    expect(deletionView(request({ status: 'PROCESSING' }))).toMatchObject({ canCancel: false });
    expect(deletionView(request({ status: 'CANCELLED' }))).toEqual({ kind: 'none' });
    expect(deletionView(null)).toEqual({ kind: 'none' });
    expect(humaniseCode('LEGAL_HOLD')).toBe('legal hold');
  });

  it('every status and blocker has copy', () => {
    for (const status of DELETION_STATUSES) expect(CATALOGUE.en[`deletion.status.${status}`]).toBeTruthy();
    for (const blocker of DELETION_BLOCKERS) expect(CATALOGUE.en[`deletion.blocker.${blocker}`]).toBeTruthy();
  });
});

describe('recovery-required refusals', () => {
  it('map to "required action" so the account state is re-read and the review opens', () => {
    expect(errorFromResponse(403, { error: { code: 'WAYVRO_E_RECOVERY_REQUIRED', message: 'x', requestId: 'r' } }).kind).toBe('required-action');
  });
});
