import { AppealCreateRequestSchema } from '@wayvro/contracts';

/**
 * Appeal statements (K05, V13), shared by the rider restriction appeal and the Driver/Partner review appeal. The
 * statement is the account holder's own words; a different human reviewer decides. On-device check only — the server
 * validates again.
 */
const APPEAL_MIN = 10;
export const APPEAL_MAX = 2000;

export type AppealTarget = { readonly reviewDecisionId: string } | { readonly restrictionId: string };
export type AppealRequest = AppealTarget & { readonly statement: string };

export function buildAppeal(target: AppealTarget, statement: string): { readonly ok: true; readonly request: AppealRequest } | { readonly ok: false } {
  const text = statement.trim();
  if (text.length < APPEAL_MIN || text.length > APPEAL_MAX) return { ok: false };
  const request: AppealRequest = { ...target, statement: text };
  return AppealCreateRequestSchema.safeParse(request).success ? { ok: true, request } : { ok: false };
}
