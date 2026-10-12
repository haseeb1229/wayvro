/**
 * Spike HTTP client for the LAN receiver. Every call is bounded by a timeout; errors become machine codes, never raw
 * provider/OS text in the UI or log.
 */
import type { ClientEvent, OfferChannel, PointsResponse, Snapshot } from '../shared/protocol.ts';
import type { ReceiverConfig } from './storage.ts';

export type ApiResult<T> = { ok: true; status: number; value: T } | { ok: false; status: number; code: string };

const DEFAULT_TIMEOUT_MS = 10_000;

async function call<T>(
  cfg: ReceiverConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: string | object,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return { ok: false, status: res.status, code: 'BAD_JSON' };
    }
    if (!res.ok) {
      const code =
        parsed !== null && typeof parsed === 'object' && 'code' in parsed && typeof parsed.code === 'string' ? parsed.code : `HTTP_${String(res.status)}`;
      return { ok: false, status: res.status, code };
    }
    return { ok: true, status: res.status, value: parsed as T };
  } catch (e) {
    return { ok: false, status: 0, code: controller.signal.aborted ? 'TIMEOUT' : e instanceof TypeError ? 'NETWORK' : 'REQUEST_FAILED' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export const api = {
  time: (cfg: ReceiverConfig) => call<{ serverTimeMs: number }>(cfg, 'GET', '/time'),
  snapshot: (cfg: ReceiverConfig, via: 'start' | 'reconnect' | 'poll' | 'foreground' | 'resume') => call<Snapshot>(cfg, 'GET', `/snapshot?via=${via}`),
  online: (cfg: ReceiverConfig, runId: string) => call<Snapshot>(cfg, 'POST', '/presence', { action: 'online', runId }),
  offline: (cfg: ReceiverConfig, runId: string, reason: string) => call<Snapshot>(cfg, 'POST', '/presence', { action: 'offline', runId, reason }, 5_000),
  /** `serializedBatch` MUST come from serializeUploadBatch (privacy allow-list + scan). */
  points: (cfg: ReceiverConfig, serializedBatch: string, signal: AbortSignal) => call<PointsResponse>(cfg, 'POST', '/points', serializedBatch, 15_000, signal),
  events: (cfg: ReceiverConfig, events: readonly ClientEvent[]) => call<{ accepted: number }>(cfg, 'POST', '/events', { events }),
  ack: (cfg: ReceiverConfig, acks: readonly { offerId: string; channel: OfferChannel; clientRecvDeviceMs: number }[]) =>
    call<{ accepted: number }>(cfg, 'POST', '/offers/ack', { acks }),
  delay: (cfg: ReceiverConfig, ms: number) => call<{ serverTimeMs: number }>(cfg, 'GET', `/delay?ms=${String(ms)}`, undefined, ms + 15_000),
};
