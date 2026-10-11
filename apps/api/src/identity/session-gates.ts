/**
 * Consumer session gates (P2.9/P2.10), kept free of service imports so the route guard and every identity service can
 * use them without import cycles:
 * - a dormant-number review restricts the session to the review itself (S12);
 * - an OIDC session on an installation that never signed in with a phone OTP must step up first (founder Q-02);
 * - sensitive actions need a fresh phone step-up (≤ 10 minutes, database time).
 */
import type { Queryable } from '@wayvro/server-runtime';

export const RESTRICTING_REVIEW_STATES = ['PENDING', 'IN_REVIEW', 'DENIED'] as const;
const STEP_UP_SECONDS = 600;

export interface SessionGates {
  readonly underReview: boolean;
  readonly phoneStepUpPending: boolean;
}

/** Both gates of a session in one query (route guard). */
export async function sessionGates(q: Queryable, sessionId: string): Promise<SessionGates> {
  const r = await q.query<SessionGates>(
    `select exists (select 1 from identity.dormant_number_reviews where session_id = $1 and status = any($2::text[])) "underReview",
            exists (select 1 from identity.sessions where id = $1 and phone_step_up_required and step_up_at is null) "phoneStepUpPending"`,
    [sessionId, [...RESTRICTING_REVIEW_STATES]],
  );
  return r.rows[0] ?? { underReview: false, phoneStepUpPending: false };
}

/** True when the session completed a step-up within the last 10 minutes (database time). */
export async function stepUpFresh(q: Queryable, sessionId: string): Promise<boolean> {
  const r = await q.query(`select 1 from identity.sessions where id = $1 and step_up_at > now() - ($2::int * interval '1 second')`, [
    sessionId,
    STEP_UP_SECONDS,
  ]);
  return (r.rowCount ?? 0) > 0;
}
