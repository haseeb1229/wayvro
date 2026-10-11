/**
 * Browser-side helpers for web-ops. Every call goes to the same-origin BFF (`/bff/...`); the browser never holds a
 * staff token. Privileged calls that answer STEP_UP_REQUIRED trigger a WebAuthn step-up and are retried ONCE with the
 * same idempotency key; STAFF_SESSION_LOCKED raises the lock overlay (server-enforced idle lock).
 */
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export class BffError extends Error {
  override readonly name = 'BffError';
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const LOCKED_EVENT = 'wayvro:session-locked';

interface Challenge {
  readonly challengeId: string;
  readonly options: Record<string, unknown>;
}

async function raw(method: string, path: string, body: unknown, key: string): Promise<Response> {
  return fetch(`/bff/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'idempotency-key': key }) },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { error?: { code: string } };
  if (!res.ok) throw new BffError(res.status, json.error?.code ?? 'WAYVRO_E_INTERNAL');
  return json as T;
}

async function assertion(purpose: 'step-up' | 'unlock'): Promise<void> {
  const opts = await parse<Challenge>(await raw('POST', `auth/${purpose}-options`, {}, crypto.randomUUID()));
  const credential = await startAuthentication({ optionsJSON: opts.options as unknown as PublicKeyCredentialRequestOptionsJSON });
  await parse(await raw('POST', purpose === 'step-up' ? 'auth/step-ups' : 'auth/unlocks', { challengeId: opts.challengeId, credential }, crypto.randomUUID()));
}

/** Calls the BFF; handles step-up (retry once, same idempotency key) and the idle lock. */
export async function bff<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const key = crypto.randomUUID();
  let res = await raw(method, path, body, key);
  if (res.status === 403) {
    const code = ((await res.clone().json()) as { error?: { code: string } }).error?.code;
    if (code === 'WAYVRO_E_STEP_UP_REQUIRED') {
      await assertion('step-up');
      res = await raw(method, path, body, key);
    }
  }
  if (res.status === 401) {
    const code = ((await res.clone().json()) as { error?: { code: string } }).error?.code;
    if (code === 'WAYVRO_E_STAFF_SESSION_LOCKED') window.dispatchEvent(new Event(LOCKED_EVENT));
  }
  return parse<T>(res);
}

export async function unlock(): Promise<void> {
  await assertion('unlock');
}

export async function login(): Promise<void> {
  const opts = await parse<Challenge>(await raw('POST', 'auth/login-options', {}, crypto.randomUUID()));
  const credential = await startAuthentication({ optionsJSON: opts.options as unknown as PublicKeyCredentialRequestOptionsJSON });
  await parse(await raw('POST', 'auth/sessions', { challengeId: opts.challengeId, credential }, crypto.randomUUID()));
}

export async function enrol(invitationToken: string, nickname: string): Promise<void> {
  const opts = await parse<Challenge>(await raw('POST', 'auth/enrolment-options', { invitationToken }, crypto.randomUUID()));
  const credential = await startRegistration({ optionsJSON: opts.options as unknown as PublicKeyCredentialCreationOptionsJSON });
  await parse(await raw('POST', 'auth/enrolments', { challengeId: opts.challengeId, invitationToken, credential, nickname }, crypto.randomUUID()));
}

export async function addAuthenticator(nickname: string): Promise<void> {
  const opts = await bff<Challenge>('POST', 'me/credential-options', {});
  const credential = await startRegistration({ optionsJSON: opts.options as unknown as PublicKeyCredentialCreationOptionsJSON });
  await bff('POST', 'me/credentials', { challengeId: opts.challengeId, credential, nickname });
}

export async function logout(): Promise<void> {
  await raw('DELETE', 'auth/sessions/current', undefined, crypto.randomUUID());
}
