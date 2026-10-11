import type { SessionList } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import type { StringKey } from '../../../core/i18n/strings';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';

/** Signed-in devices (A11 UI). The list carries no IP address or location; times are server values. */
export interface SessionRow {
  readonly id: string;
  readonly current: boolean;
  readonly platformKey: Extract<StringKey, 'sessions.android' | 'sessions.ios'>;
  readonly appVersion: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

export interface SessionsModel {
  readonly current: SessionRow | null;
  /** Other sessions, most recently used first; each can be signed out (the current one signs out via "Sign out"). */
  readonly others: readonly SessionRow[];
  readonly canRevokeOthers: boolean;
}

export function sessionsModel(list: SessionList): SessionsModel {
  const rows: SessionRow[] = list.sessions.map((s) => ({
    id: s.id,
    current: s.current,
    platformKey: s.platform === 'IOS' ? 'sessions.ios' : 'sessions.android',
    appVersion: s.appVersion,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
  }));
  const others = rows.filter((r) => !r.current).sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  return { current: rows.find((r) => r.current) ?? null, others, canRevokeOthers: others.length > 0 };
}

export type RevokeOutcome = { readonly kind: 'done'; readonly messageKey: StringKey } | { readonly kind: 'failed'; readonly view: UiErrorView };

/**
 * Outcome of signing out one other device after the call failed. A 404 means the session is already gone (signed out
 * elsewhere or expired): treated as done, and the list is refetched either way.
 */
export function revokeOneFailure(error: unknown): RevokeOutcome {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_NOT_FOUND') return { kind: 'done', messageKey: 'sessions.revoked' };
  return { kind: 'failed', view: errorView(apiError) };
}
