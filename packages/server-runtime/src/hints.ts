/**
 * Internal account-state hint channel (P2.7): the worker's outbox consumer publishes `{ accountId, cause, eventId }` on
 * a Valkey channel; every realtime process subscribes and emits `account.state-changed.v1` to that account's own
 * sockets. Hints carry ids and an event type only — never state — and are best-effort: realtime is a delivery channel,
 * clients re-fetch authoritative state over HTTP (ADR-005b).
 */
import { z } from 'zod';

export const ACCOUNT_HINT_CHANNEL = 'wayvro:account-state:v1';

const AccountHintSchema = z.strictObject({
  accountId: z.uuid(),
  cause: z.string().regex(/^[a-z]+(?:\.[a-z-]+)+\.v\d+$/),
  eventId: z.uuid(),
});
export type AccountHint = z.infer<typeof AccountHintSchema>;

/** Parses a channel message; malformed or foreign messages are null (dropped, never trusted). */
export function parseAccountHint(message: string): AccountHint | null {
  try {
    const r = AccountHintSchema.safeParse(JSON.parse(message));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
