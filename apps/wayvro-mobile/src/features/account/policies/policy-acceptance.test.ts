import type { ConsentRecorded, ConsentRequest } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/api/errors';
import { consentStatuses, IDS, policyList } from '../../../__mocks__/fixtures';
import { acceptanceError, acceptPending, consentRequestFor, policyAcceptanceModel } from './policy-acceptance';

const recorded = (request: ConsentRequest, requiredActions: ConsentRecorded['requiredActions']): ConsentRecorded => ({
  id: IDS.consent,
  policyKey: request.policyKey,
  version: request.version,
  locale: request.locale,
  action: request.action,
  recordedAt: '2026-10-11T10:00:00.000Z',
  requiredActions,
});

describe('policy acceptance', () => {
  it('shows only ACCOUNT policies the server marks acceptance-required (never driver policies), with placeholder labels', () => {
    const model = policyAcceptanceModel({
      consents: consentStatuses(['TERMS', 'PRIVACY']),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(model.items.map((i) => i.policyKey)).toEqual(['TERMS', 'PRIVACY']);
    expect(model.items.every((i) => i.placeholder)).toBe(true);
    expect(model.items.some((i) => i.policyKey === 'DRIVER_PARTNER_AGREEMENT')).toBe(false);
    expect(model.canAccept).toBe(true);
  });

  it('binds each acceptance to the exact version, locale and content hash shown', () => {
    const model = policyAcceptanceModel({
      consents: consentStatuses(['TERMS']),
      localized: policyList('ur'),
      english: policyList('en'),
      uiIsEnglish: false,
      acceptedNow: new Set(),
    });
    expect(consentRequestFor(model.items[0]!)).toEqual({ policyKey: 'TERMS', version: 1, locale: 'ur', contentSha256: 'c'.repeat(64), action: 'ACCEPTED' });
  });

  it('falls back to English (labelled) when the UI locale lacks the current version, and waits when neither has it', () => {
    const fallback = policyAcceptanceModel({
      consents: consentStatuses(['TERMS']),
      localized: policyList('ur', { TERMS: 9 }),
      english: policyList('en'),
      uiIsEnglish: false,
      acceptedNow: new Set(),
    });
    expect(fallback.items[0]).toMatchObject({ locale: 'en', shownInEnglish: true });

    const syncing = policyAcceptanceModel({
      consents: consentStatuses(['TERMS']),
      localized: policyList('en', { TERMS: 9 }),
      english: policyList('en', { TERMS: 9 }),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(syncing).toMatchObject({ items: [], syncing: ['TERMS'], canAccept: false });
  });

  it('shows the change summary only for re-acceptance', () => {
    const fresh = policyAcceptanceModel({
      consents: consentStatuses(['PRIVACY']),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(fresh.items[0]?.changeSummary).toBeNull();
    const again = policyAcceptanceModel({
      consents: consentStatuses(['PRIVACY'], 1),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(again.items[0]?.changeSummary).toBe('Clarified retention.');
  });

  it('is empty when nothing needs acceptance', () => {
    const model = policyAcceptanceModel({
      consents: consentStatuses([]),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(model).toEqual({ items: [], syncing: [], canAccept: false });
  });

  it('records each pending policy in order and returns the server requiredActions of the last record', async () => {
    const model = policyAcceptanceModel({
      consents: consentStatuses(['TERMS', 'PRIVACY']),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    const sent: string[] = [];
    const result = await acceptPending(model.items, (request) => {
      sent.push(request.policyKey);
      return Promise.resolve(recorded(request, request.policyKey === 'PRIVACY' ? ['AGE_DECLARATION'] : ['ACCEPT_POLICIES', 'AGE_DECLARATION']));
    });
    expect(sent).toEqual(['TERMS', 'PRIVACY']);
    expect(result).toEqual({ accepted: ['TERMS', 'PRIVACY'], failure: null, requiredActions: ['AGE_DECLARATION'] });
    expect(acceptanceError(result)).toBeNull();
  });

  it('reports partial success and stops at the first failure; skips already-accepted items on retry', async () => {
    const consents = consentStatuses(['TERMS', 'PRIVACY']);
    const model = policyAcceptanceModel({ consents, localized: policyList('en'), english: policyList('en'), uiIsEnglish: true, acceptedNow: new Set() });
    const result = await acceptPending(model.items, (request) =>
      request.policyKey === 'PRIVACY' ? Promise.reject(new ApiError('offline', { transient: true })) : Promise.resolve(recorded(request, ['ACCEPT_POLICIES'])),
    );
    expect(result.accepted).toEqual(['TERMS']);
    expect(acceptanceError(result)).toMatchObject({ partial: true, refetch: false, view: { messageKey: 'policies.partial', action: 'retry' } });

    const retryModel = policyAcceptanceModel({
      consents,
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(['TERMS']),
    });
    const sent: string[] = [];
    await acceptPending(retryModel.items, (request) => {
      sent.push(request.policyKey);
      return Promise.resolve(recorded(request, []));
    });
    expect(sent).toEqual(['PRIVACY']);
  });

  it('a 409 conflict (policy changed) asks for a refetch and re-review', async () => {
    const model = policyAcceptanceModel({
      consents: consentStatuses(['TERMS']),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    const result = await acceptPending(model.items, () => Promise.reject(new ApiError('conflict', { code: 'WAYVRO_E_CONFLICT', status: 409 })));
    expect(acceptanceError(result)).toMatchObject({ refetch: true, partial: false, view: { messageKey: 'policies.changed' } });
  });
});

describe('policy acceptance — Driver/Partner scope (P2.8, K14)', () => {
  it('collects only DRIVER_APPLICATION policies in the driver flow', () => {
    const model = policyAcceptanceModel({
      scope: 'DRIVER_APPLICATION',
      consents: consentStatuses(['TERMS']),
      localized: policyList('en'),
      english: policyList('en'),
      uiIsEnglish: true,
      acceptedNow: new Set(),
    });
    expect(model.items.map((i) => i.policyKey)).toEqual(['DRIVER_PARTNER_AGREEMENT']);
    expect(model.canAccept).toBe(true);
  });
});
