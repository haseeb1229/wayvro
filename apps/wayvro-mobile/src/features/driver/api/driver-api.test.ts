import { describe, expect, it } from 'vitest';
import { application, checklist, compliance, DRIVER_IDS, evidence } from '../../../__mocks__/driver-fixtures';
import { errorBody, jsonResponse, tokens } from '../../../__mocks__/fixtures';
import { MemoryStore } from '../../../__mocks__/memory-store';
import { ApiError } from '../../../core/api/errors';
import type { HttpDeps } from '../../../core/api/http';
import { createIdempotencyIntentStore } from '../../../core/api/idempotency-intents';
import { createRefreshCall, createWayvroClient } from '../../../core/api/wayvro-client';
import { SessionManager } from '../../../core/session/session-manager';
import { createDriverApi } from './driver-api';

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;

async function harness(handler: Handler) {
  const calls: { path: string; init: RequestInit }[] = [];
  const store = new MemoryStore();
  let n = 0;
  const newKey = () => `idem_key_${String(++n).padStart(16, '0')}`;
  const http: HttpDeps = {
    baseUrl: 'https://api.example.test',
    fetchFn: (async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.example.test', '');
      calls.push({ path, init });
      return handler(path, init);
    }) as typeof fetch,
    newRequestId: () => 'req_synthetic_0001',
    clock: { offsetMs: 0 },
    sleep: () => Promise.resolve(),
    random: () => 0,
  };
  const session = new SessionManager({ store, refreshCall: createRefreshCall(http), newIdempotencyKey: newKey });
  await session.establish(tokens(1));
  const client = createWayvroClient({
    http,
    session,
    intents: createIdempotencyIntentStore(store, newKey),
    installationId: 'installation_synthetic_01',
    device: { platform: 'ANDROID', appVersion: '0.0.0' },
    fingerprint: (s) => Promise.resolve(`fp:${s}`),
  });
  const header = (i: number, name: string) => (calls[i]?.init.headers as Record<string, string>)[name];
  const body = (i: number): unknown => {
    const raw = calls[i]?.init.body;
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  };
  return { api: createDriverApi(client.session), calls, header, body };
}

const APP = `/v1/driver-onboarding/applications/${DRIVER_IDS.application}`;

describe('driver API on the contract schemas', () => {
  it('creates the Lahore/CAR application with a bearer token and an idempotency key; no role or mode is ever sent', async () => {
    const h = await harness(() => jsonResponse(201, application({ state: 'DRAFT' })));
    const app = await h.api.createApplication();
    expect(app.state).toBe('DRAFT');
    expect(h.calls[0]?.path).toBe('/v1/driver-onboarding/applications');
    expect(h.body(0)).toEqual({ cityCode: 'LHR', serviceCategories: ['CAR'] });
    expect(h.header(0, 'authorization')).toBe(`Bearer ${tokens(1).accessToken}`);
    expect(h.header(0, 'idempotency-key')).toMatch(/^idem_key_/);
  });

  it('claims carry the expected version; a stale version surfaces as a conflict', async () => {
    const h = await harness(() => jsonResponse(409, errorBody('WAYVRO_E_CONFLICT')));
    await expect(h.api.updateClaims(DRIVER_IDS.application, { expectedVersion: 3, legalName: 'Test Applicant' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(h.calls[0]?.path).toBe(`${APP}/claims`);
    expect(h.body(0)).toEqual({ expectedVersion: 3, legalName: 'Test Applicant' });
  });

  it('a response that violates the contract is never trusted', async () => {
    const h = await harness(() => jsonResponse(200, { ...application(), state: 'APPROVED_BY_MAGIC' }));
    await expect(h.api.currentApplication()).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('requirements, evidence list and compliance are validated reads', async () => {
    const h = await harness((path) => {
      if (path.endsWith('/requirements')) return jsonResponse(200, checklist());
      if (path.endsWith('/evidence')) return jsonResponse(200, { items: [evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'ACCEPTED')] });
      return jsonResponse(200, compliance());
    });
    expect((await h.api.requirements(DRIVER_IDS.application)).isPlaceholder).toBe(true);
    expect((await h.api.evidence(DRIVER_IDS.application)).items).toHaveLength(1);
    expect((await h.api.compliance()).applicationId).toBe(DRIVER_IDS.application);
    expect(h.calls.map((c) => c.init.method)).toEqual(['GET', 'GET', 'GET']);
  });

  it('upload slot → completion → discard use the evidence routes; slot retries reuse the same key', async () => {
    let attempt = 0;
    const h = await harness((path, init) => {
      if (path.endsWith('/evidence-uploads') && init.method === 'POST') {
        attempt += 1;
        if (attempt === 1) throw new TypeError('network down');
        return jsonResponse(201, {
          uploadId: DRIVER_IDS.upload1,
          upload: {
            url: 'https://storage.example.test/q/synthetic',
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            expiresAt: '2026-10-11T10:05:00.000Z',
          },
          slotExpiresAt: '2026-10-11T10:05:00.000Z',
        });
      }
      if (path.endsWith('/completion')) return jsonResponse(200, evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'PROCESSING'));
      return new Response(null, { status: 204 });
    });
    const slot = await h.api.requestEvidenceSlot('local_item_000001', DRIVER_IDS.application, {
      documentId: DRIVER_IDS.cnicDoc,
      kind: 'CNIC_FRONT',
      captureSource: 'IN_APP_CAMERA',
      byteSize: 1234,
      mime: 'image/jpeg',
    });
    expect(slot.uploadId).toBe(DRIVER_IDS.upload1);
    expect(h.header(0, 'idempotency-key')).toBe(h.header(1, 'idempotency-key'));
    expect((await h.api.completeEvidenceUpload(DRIVER_IDS.upload1)).status).toBe('PROCESSING');
    await h.api.discardEvidenceUpload(DRIVER_IDS.upload1);
    expect(h.calls.map((c) => `${c.init.method ?? ''} ${c.path}`).slice(2)).toEqual([
      `POST /v1/driver-onboarding/evidence-uploads/${DRIVER_IDS.upload1}/completion`,
      `DELETE /v1/driver-onboarding/evidence-uploads/${DRIVER_IDS.upload1}`,
    ]);
  });

  it('submission refusals keep the itemised reason codes for the checklist', async () => {
    const h = await harness(() =>
      jsonResponse(409, {
        error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'req_1', details: { reasonCodes: ['MISSING_DOCUMENT_CNIC', 'EVIDENCE_PROCESSING'] } },
      }),
    );
    const error: unknown = await h.api.submit(DRIVER_IDS.application, 4).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail.reasonCodes).toEqual(['MISSING_DOCUMENT_CNIC', 'EVIDENCE_PROCESSING']);
    expect(h.body(0)).toEqual({ expectedVersion: 4 });
  });

  it('capture challenge decline and renewal start/submission', async () => {
    const h = await harness((path) => {
      if (path.endsWith('/declines')) return jsonResponse(200, { status: 'DECLINED_ACCESSIBILITY', replacement: null });
      if (path.endsWith('/renewals') || path.endsWith('/renewal-submission'))
        return jsonResponse(path.endsWith('/renewals') ? 201 : 200, {
          renewalDocumentId: DRIVER_IDS.renewalDoc,
          applicationId: DRIVER_IDS.application,
          renews: DRIVER_IDS.licenceDoc,
          documentType: 'DRIVING_LICENCE',
          evidenceKinds: ['LICENCE_FRONT', 'LICENCE_BACK'],
          status: path.endsWith('/renewals') ? 'DRAFT' : 'IN_REVIEW',
        });
      return jsonResponse(404, errorBody('WAYVRO_E_NOT_FOUND'));
    });
    expect((await h.api.declineCaptureChallenge(DRIVER_IDS.application, DRIVER_IDS.challenge, 'NONE_ACCESSIBLE')).status).toBe('DECLINED_ACCESSIBILITY');
    expect(h.body(0)).toEqual({ choice: 'NONE_ACCESSIBLE' });
    expect((await h.api.startRenewal(DRIVER_IDS.licenceDoc, { expiresOn: '2030-01-01' })).status).toBe('DRAFT');
    expect(h.calls[1]?.path).toBe(`/v1/driver/documents/${DRIVER_IDS.licenceDoc}/renewals`);
    expect((await h.api.submitRenewal(DRIVER_IDS.renewalDoc)).status).toBe('IN_REVIEW');
    expect(h.calls[2]?.path).toBe(`/v1/driver/documents/${DRIVER_IDS.renewalDoc}/renewal-submission`);
  });

  it('feature switched off and policy acceptance refusals keep their codes', async () => {
    const off = await harness(() => jsonResponse(403, errorBody('WAYVRO_E_FEATURE_DISABLED')));
    await expect(off.api.createApplication()).rejects.toMatchObject({ kind: 'feature-disabled' });
    const policies = await harness(() => jsonResponse(403, errorBody('WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED')));
    await expect(policies.api.confirmConsent(DRIVER_IDS.application)).rejects.toMatchObject({
      kind: 'required-action',
      code: 'WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED',
    });
  });
});
