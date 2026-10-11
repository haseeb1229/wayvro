import { z } from 'zod';

/**
 * Realtime recovery contract (ADR-005b). Realtime is a delivery channel, never the source of truth: on every
 * (re)connect the server sends `session.hello` and the client re-fetches authoritative state over HTTP before showing
 * it; events carry a per-aggregate monotonic `version` and clients apply only `version === last + 1`.
 */
export const REALTIME_PROTOCOL_VERSION = 1;

export const SessionHelloSchema = z.object({
  type: z.literal('session.hello'),
  protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
  serverTime: z.iso.datetime(),
  resync: z.literal('fetch-snapshot'),
});
export type SessionHello = z.infer<typeof SessionHelloSchema>;

export const RealtimeEventEnvelopeSchema = z.object({
  type: z.string().regex(/^[a-z]+(?:\.[a-z]+)+\.v\d+$/),
  aggregate: z.object({ kind: z.string().min(1), id: z.string().min(1) }),
  version: z.number().int().nonnegative(),
  emittedAt: z.iso.datetime(),
});
export type RealtimeEventEnvelope = z.infer<typeof RealtimeEventEnvelopeSchema>;

export const REALTIME_EVENTS = { sessionHello: 'session.hello', accountStateChanged: 'account.state-changed.v1' } as const;

/**
 * P2.7: a state-change HINT for the caller's own account (driver application decided, restriction changed, appeal
 * decided, …). It carries no data: the client re-fetches `/v1/account/state` (and the affected resource) over HTTP.
 */
export const AccountStateChangedSchema = z.object({
  type: z.literal('account.state-changed.v1'),
  cause: z.string().regex(/^[a-z]+(?:\.[a-z-]+)+\.v\d+$/),
  resync: z.literal('fetch-snapshot'),
  emittedAt: z.iso.datetime(),
});
export type AccountStateChanged = z.infer<typeof AccountStateChangedSchema>;
