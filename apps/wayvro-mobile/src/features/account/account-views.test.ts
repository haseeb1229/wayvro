import type { AccountState, SecurityEventList, SessionList } from '@wayvro/contracts';
import { LOCALES, REASON_CLASS_VALUES, SECURITY_EVENT_TYPES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/errors';
import { CATALOGUE } from '../../core/i18n/strings';
import { accountState, IDS, policyList } from '../../__mocks__/fixtures';
import { viewStateFromQuery } from '../../core/ui/view-state';
import { legalListModel } from './legal/legal';
import { driverEntry, homeModel } from './home/home';
import { riderRestrictionNotices } from './home/restrictions';
import { buildProfileUpdate, draftFrom } from './profile/profile-edit';
import { securityEventsModel } from './security/security-activity';
import { revokeOneFailure, sessionsModel } from './sessions/sessions';

describe('home', () => {
  it('greets by display name, or generically when there is none', () => {
    expect(homeModel(accountState([], 'Ayesha'))).toMatchObject({ greetingKey: 'home.greeting', name: 'Ayesha', preferredLocale: 'en' });
    expect(homeModel(accountState([], null))).toMatchObject({ greetingKey: 'home.greetingNoName', name: null });
    expect(homeModel(accountState([], '   '))).toMatchObject({ greetingKey: 'home.greetingNoName', name: null });
  });
});

describe('profile edit', () => {
  const original = { displayName: 'Ayesha', preferredLocale: 'en' as const };

  it('sends only changed allowlisted fields', () => {
    expect(buildProfileUpdate(original, { displayName: ' Ayesha ', preferredLocale: 'en' })).toEqual({ ok: false, reason: 'no-changes' });
    expect(buildProfileUpdate(original, { displayName: 'Ayesha', preferredLocale: 'ur' })).toEqual({ ok: true, update: { preferredLocale: 'ur' } });
    expect(buildProfileUpdate(original, { displayName: 'Sana', preferredLocale: 'en' })).toEqual({ ok: true, update: { displayName: 'Sana' } });
  });

  it('an empty name removes it (null); invalid names are refused with the contract rules', () => {
    expect(buildProfileUpdate(original, { displayName: '  ', preferredLocale: 'en' })).toEqual({ ok: true, update: { displayName: null } });
    expect(buildProfileUpdate(original, { displayName: 'x'.repeat(61), preferredLocale: 'en' })).toEqual({ ok: false, reason: 'invalid-name' });
    expect(buildProfileUpdate(original, { displayName: 'evil‮eman', preferredLocale: 'en' })).toEqual({ ok: false, reason: 'invalid-name' });
    expect(buildProfileUpdate({ displayName: null, preferredLocale: 'ur-Latn' }, draftFrom({ displayName: null, preferredLocale: 'ur-Latn' }))).toEqual({
      ok: false,
      reason: 'no-changes',
    });
  });
});

describe('sessions', () => {
  const list: SessionList = {
    sessions: [
      {
        id: IDS.otherSession,
        current: false,
        platform: 'IOS',
        appVersion: '0.0.0',
        createdAt: '2026-10-01T09:00:00.000Z',
        lastUsedAt: '2026-10-02T09:00:00.000Z',
      },
      {
        id: IDS.session,
        current: true,
        platform: 'ANDROID',
        appVersion: '0.0.0',
        createdAt: '2026-10-05T09:00:00.000Z',
        lastUsedAt: '2026-10-11T09:00:00.000Z',
      },
      {
        id: IDS.event1,
        current: false,
        platform: 'ANDROID',
        appVersion: '0.0.0',
        createdAt: '2026-10-03T09:00:00.000Z',
        lastUsedAt: '2026-10-09T09:00:00.000Z',
      },
    ],
  };

  it('marks the current session and lists others most recent first', () => {
    const model = sessionsModel(list);
    expect(model.current?.id).toBe(IDS.session);
    expect(model.others.map((r) => r.id)).toEqual([IDS.event1, IDS.otherSession]);
    expect(model.others[1]?.platformKey).toBe('sessions.ios');
    expect(model.canRevokeOthers).toBe(true);
  });

  it('cannot revoke others when this phone is the only session', () => {
    expect(sessionsModel({ sessions: list.sessions.filter((s) => s.current) })).toMatchObject({ others: [], canRevokeOthers: false });
  });

  it('treats an already-gone session (404) as done; other failures are shown', () => {
    expect(revokeOneFailure(new ApiError('conflict', { code: 'WAYVRO_E_NOT_FOUND', status: 404 }))).toEqual({ kind: 'done', messageKey: 'sessions.revoked' });
    expect(revokeOneFailure(new ApiError('offline'))).toMatchObject({ kind: 'failed', view: { messageKey: 'error.offline' } });
  });
});

describe('security activity', () => {
  it('labels every server event type from the catalogue, newest first', () => {
    const list: SecurityEventList = {
      events: [
        { id: IDS.event1, type: 'SIGN_IN', occurredAt: '2026-10-01T09:00:00.000Z' },
        { id: IDS.event2, type: 'SESSIONS_REVOKED_OTHERS', occurredAt: '2026-10-05T09:00:00.000Z' },
      ],
    };
    expect(securityEventsModel(list)).toEqual([
      { id: IDS.event2, labelKey: 'security.event.SESSIONS_REVOKED_OTHERS', occurredAt: '2026-10-05T09:00:00.000Z' },
      { id: IDS.event1, labelKey: 'security.event.SIGN_IN', occurredAt: '2026-10-01T09:00:00.000Z' },
    ]);
    for (const type of SECURITY_EVENT_TYPES) expect(CATALOGUE.ur[`security.event.${type}`]).toBeTruthy();
  });
});

describe('screen view states (adapter + query snapshot)', () => {
  const offline = new ApiError('offline', { transient: true });
  const expired = new ApiError('session-expired', { status: 401 });

  it('security activity: loading, empty, ready, offline and session-expired', () => {
    const isEmpty = (rows: readonly unknown[]) => rows.length === 0;
    expect(viewStateFromQuery({ status: 'pending', data: undefined, error: null }, securityEventsModel, isEmpty)).toEqual({ kind: 'loading' });
    expect(viewStateFromQuery({ status: 'success', data: { events: [] }, error: null }, securityEventsModel, isEmpty)).toEqual({ kind: 'empty' });
    expect(
      viewStateFromQuery(
        { status: 'success', data: { events: [{ id: IDS.event1, type: 'SIGN_IN', occurredAt: '2026-10-01T09:00:00.000Z' }] }, error: null },
        securityEventsModel,
        isEmpty,
      ).kind,
    ).toBe('ready');
    expect(viewStateFromQuery({ status: 'error', data: undefined, error: offline }, securityEventsModel, isEmpty)).toMatchObject({
      kind: 'error',
      error: { kind: 'offline', action: 'retry' },
    });
    expect(viewStateFromQuery({ status: 'error', data: undefined, error: expired }, securityEventsModel, isEmpty)).toMatchObject({
      kind: 'error',
      error: { kind: 'session-expired', messageKey: 'error.sessionExpired' },
    });
  });

  it('legal list: empty when the server lists no rider-relevant policy; stale data kept on a failed refresh', () => {
    const isEmpty = (items: readonly unknown[]) => items.length === 0;
    expect(viewStateFromQuery({ status: 'success', data: { policies: [] }, error: null }, legalListModel, isEmpty)).toEqual({ kind: 'empty' });
    expect(viewStateFromQuery({ status: 'error', data: policyList('en'), error: offline }, legalListModel, isEmpty)).toMatchObject({
      kind: 'ready',
      stale: { kind: 'offline' },
    });
  });

  it('home and sessions: error states before any data, ready afterwards', () => {
    expect(viewStateFromQuery({ status: 'error', data: undefined, error: offline }, homeModel).kind).toBe('error');
    expect(viewStateFromQuery({ status: 'success', data: accountState(), error: null }, homeModel)).toMatchObject({ kind: 'ready', stale: null });
    expect(viewStateFromQuery({ status: 'pending', data: undefined, error: null }, sessionsModel)).toEqual({ kind: 'loading' });
  });
});

describe('restriction messaging (V13)', () => {
  const restriction = (over: Partial<AccountState['restrictions'][number]>): AccountState['restrictions'][number] => ({
    id: IDS.consent,
    scope: 'ACCOUNT',
    reasonCode: 'SYNTHETIC_REASON',
    reasonClass: 'SECURITY_HOLD',
    appealable: true,
    effectiveUntil: '2026-11-01T00:00:00.000Z',
    affectsRiderUse: true,
    ...over,
  });

  it('shows only restrictions the server marks as affecting rider use, localised by reason class', () => {
    const state = accountState([], 'Ayesha', [
      restriction({}),
      restriction({ id: IDS.event1, scope: 'DRIVER_ROLE', reasonClass: 'COMPLIANCE', affectsRiderUse: false }),
    ]);
    expect(homeModel(state).restrictions).toEqual([
      {
        id: IDS.consent,
        messageKey: 'restriction.class.SECURITY_HOLD',
        reasonCode: 'SYNTHETIC_REASON',
        effectiveUntil: '2026-11-01T00:00:00.000Z',
        appealable: true,
      },
    ]);
    expect(riderRestrictionNotices(accountState())).toEqual([]);
  });

  it('has copy for every reason class in every locale', () => {
    for (const reasonClass of REASON_CLASS_VALUES) for (const locale of LOCALES) expect(CATALOGUE[locale][`restriction.class.${reasonClass}`]).toBeTruthy();
  });
});

describe('home — Driver/Partner entry (P2.8, one app)', () => {
  const driver = (overrides: Partial<AccountState['driver']>): AccountState['driver'] => ({
    application: null,
    profile: null,
    onboardingAvailable: false,
    ...overrides,
  });

  it('offers "Earn with Wayvro" only when the server says onboarding is available', () => {
    expect(driverEntry(driver({}))).toBeNull();
    expect(driverEntry(driver({ onboardingAvailable: true }))).toBe('apply');
    expect(driverEntry(driver({ onboardingAvailable: true, application: { id: IDS.account, state: 'DRAFT' } }))).toBe('driver');
    expect(driverEntry(driver({ application: { id: IDS.account, state: 'DRAFT' } }))).toBeNull();
  });

  it('a verified driver always reaches the Driver/Partner area', () => {
    expect(driverEntry(driver({ profile: { id: IDS.account, state: 'VERIFIED' } }))).toBe('driver');
    expect(homeModel(accountState()).driverEntry).toBeNull();
  });
});

describe('home — deletion pending (P2.9)', () => {
  it('flags the restricted deletion grace period from the server status', () => {
    const state = accountState();
    expect(homeModel(state).deletionPending).toBe(false);
    expect(homeModel({ ...state, account: { ...state.account, status: 'DELETION_PENDING' } }).deletionPending).toBe(true);
  });
});
