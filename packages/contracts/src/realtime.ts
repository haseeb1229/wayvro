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

export const REALTIME_EVENTS = { sessionHello: 'session.hello' } as const;
