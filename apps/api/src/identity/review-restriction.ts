/**
 * Dormant-number review restriction (S12): the states in which a session stays restricted to the review itself.
 * Kept free of service imports so the route guard can use it without pulling identity services into auth.
 */
import type { Queryable } from '@wayvro/server-runtime';

export const RESTRICTING_REVIEW_STATES = ['PENDING', 'IN_REVIEW', 'DENIED'] as const;

/** True when the session is restricted by a dormant-number review (route guard). */
export async function sessionUnderReview(q: Queryable, sessionId: string): Promise<boolean> {
  const r = await q.query(`select 1 from identity.dormant_number_reviews where session_id = $1 and status = any($2::text[])`, [
    sessionId,
    [...RESTRICTING_REVIEW_STATES],
  ]);
  return (r.rowCount ?? 0) > 0;
}
