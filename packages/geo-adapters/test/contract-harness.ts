/**
 * Test-only harness for the ACCOUNT-FREE provider contract tests (google.contract.test.ts, mapbox.contract.test.ts).
 * No network, no provider account, no real key: every request goes to `fakeFetch` and is answered with a hand-written
 * SYNTHETIC payload. These tests prove Wayvro-side behaviour against the publicly documented shapes only; they do not
 * prove that a real provider answers that way.
 */
import { inspect } from 'node:util';
import type { GeoAdapterLicence, GeoSku } from '@wayvro/provider-interfaces';
import { expect } from 'vitest';
import { GeoAdapterError, type GeoAdapterErrorCode } from '../src/errors.js';
import type { FetchLike } from '../src/http.js';
import { fakeFetch, type RecordedRequest, type Responder } from './fake-fetch.js';

/** Obviously fake credential values (match the config loaders' formats; never a real key). */
export const FAKE_GOOGLE_KEY = 'test-key-not-real-google-0123456789';
export const FAKE_MAPBOX_TOKEN = 'pk.test-key-not-real-mapbox-0123456789';
/** Query text sentinel: must never appear in an error, log line or telemetry surface. */
export const QUERY_SENTINEL = 'zq sentinel query';
/** Provider-body sentinel: provider error bodies are drained, never copied. */
export const BODY_SENTINEL = 'PROVIDER-BODY-SENTINEL';
export const SESSION = '6f1c2b8e-0000-4000-8000-00000000c0de';

export interface BoundOp {
  readonly call: (signal: AbortSignal) => Promise<unknown>;
  readonly licences: readonly GeoAdapterLicence[];
}

/** One adapter operation under contract test. */
export interface ContractOp {
  readonly name: string;
  readonly sku: GeoSku;
  /** Builds a fresh adapter on `fetchImpl` and binds the operation with synthetic input. */
  readonly make: (fetchImpl: FetchLike) => BoundOp;
  /** A documented-shape success payload for this operation. */
  readonly ok: () => Response;
  /** Code expected for HTTP 404 (place resolution maps it to NOT_FOUND; everything else is a client error). */
  readonly http404: GeoAdapterErrorCode;
}

export function bind(op: ContractOp, responder: Responder): { readonly bound: BoundOp; readonly requests: RecordedRequest[] } {
  const fake = fakeFetch(responder);
  return { bound: op.make(fake.fetchImpl), requests: fake.requests };
}

export async function failureOf(promise: Promise<unknown>): Promise<GeoAdapterError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GeoAdapterError);
  return error as GeoAdapterError;
}

/** Every rendering of the error (message, String, stack, JSON, util.inspect) is free of the secrets; no `cause`. */
export function expectNoLeak(error: GeoAdapterError, secrets: readonly string[]): void {
  const surfaces = [error.message, String(error), error.stack ?? '', JSON.stringify(error), inspect(error, { depth: 5 })];
  for (const secret of secrets) for (const surface of surfaces) expect(surface).not.toContain(secret);
  expect(error.cause).toBeUndefined();
}

export const HTTP_ERROR_STATUSES = [400, 401, 403, 404, 429, 500, 503] as const;

export function expectedHttpCode(op: ContractOp, status: (typeof HTTP_ERROR_STATUSES)[number]): GeoAdapterErrorCode {
  switch (status) {
    case 401:
    case 403:
      return 'AUTH';
    case 404:
      return op.http404;
    case 429:
      return 'QUOTA';
    case 500:
    case 503:
      return 'SERVER_ERROR';
    default:
      return 'CLIENT_ERROR';
  }
}

/** Body-level failures on HTTP 200: truncated JSON, an HTML page and a body whose types match no adapter schema. */
export const MALFORMED_BODIES: readonly (readonly [string, () => Response])[] = [
  ['truncated JSON', () => new Response('{"suggestions":[{"x":', { status: 200, headers: { 'content-type': 'application/json' } })],
  ['HTML error page', () => new Response(`<!doctype html><title>${BODY_SENTINEL}</title>`, { status: 200, headers: { 'content-type': 'text/html' } })],
  [
    'schema mismatch',
    () =>
      new Response(JSON.stringify({ suggestions: BODY_SENTINEL, status: 5, features: BODY_SENTINEL, routes: BODY_SENTINEL, code: 5, location: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ],
];

/** A 200 response whose body stalls until `signal` aborts (headers arrived, body never completes). */
export function stallingBody(signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => {
        controller.error(signal.reason);
      });
    },
  });
  return new Response(stream, { status: 200 });
}

/** A transport failure whose message echoes the outbound URL (which may carry the key) and a body sentinel. */
export function connectFailure(request: RecordedRequest): Promise<Response> {
  return Promise.reject(new TypeError(`fetch failed ${request.url.toString()} ${BODY_SENTINEL}`));
}
