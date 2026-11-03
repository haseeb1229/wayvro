/**
 * Test-only fake `fetch`: records every outbound request and answers with HAND-WRITTEN SYNTHETIC payloads (never a
 * captured provider response). Honours the AbortSignal like the real fetch.
 */
import type { FetchLike } from '../src/http.js';

export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly redirect: RequestInit['redirect'];
}

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export function fakeFetch(responder: Responder): { readonly fetchImpl: FetchLike; readonly requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const recorded: RecordedRequest = {
      url: new URL(url),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      redirect: init.redirect,
    };
    requests.push(recorded);
    const signal = init.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason as Error);
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
      Promise.resolve(responder(recorded)).then(resolve, reject);
    });
  };
  return { fetchImpl, requests };
}

/** A synthetic JSON response. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A response that never resolves (used with AbortSignal timeouts). */
export function never(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

/** Encodes points as an encoded polyline (test fixtures only). */
export function encodePolyline(points: readonly { lat: number; lng: number }[], precision: 5 | 6): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    encode(lat - prevLat);
    encode(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** Synthetic Lahore-area points (round numbers; not field data). */
export const SYNTHETIC = {
  a: { lat: 31.5, lng: 74.3 },
  b: { lat: 31.55, lng: 74.35 },
  c: { lat: 31.6, lng: 74.4 },
} as const;
