import { toApiError, type UiErrorKind } from '../api/errors';
import type { StringKey, TranslationParams } from '../i18n/strings';

/**
 * View-state adapters (CLAUDE.md §10): screens render ONLY these shapes, so loading/empty/error/offline/expired states
 * are decided by pure, tested functions rather than ad-hoc component logic.
 */

export interface UiErrorView {
  readonly kind: UiErrorKind;
  readonly messageKey: StringKey;
  readonly params?: TranslationParams;
  /** What the primary action of the error state does. */
  readonly action: 'retry' | 'sign-in' | 'none';
}

export type ViewState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: UiErrorView }
  | { readonly kind: 'empty' }
  /** `stale` is set when cached data is shown after a failed background refresh (partial success). */
  | { readonly kind: 'ready'; readonly data: T; readonly stale: UiErrorView | null };

const MESSAGE_BY_KIND: Readonly<Record<Exclude<UiErrorKind, 'rate-limited'>, StringKey>> = {
  offline: 'error.offline',
  'session-expired': 'error.sessionExpired',
  validation: 'error.validation',
  conflict: 'error.conflict',
  'step-up-required': 'error.stepUp',
  'required-action': 'error.requiredAction',
  restricted: 'error.restricted',
  'feature-disabled': 'error.featureDisabled',
  'service-area': 'error.serviceArea',
  'update-required': 'error.updateRequired',
  maintenance: 'error.maintenance',
  unavailable: 'error.unavailable',
  unknown: 'error.unknown',
};

const ACTION_BY_KIND: Readonly<Record<UiErrorKind, UiErrorView['action']>> = {
  offline: 'retry',
  'rate-limited': 'retry',
  'session-expired': 'sign-in',
  validation: 'none',
  conflict: 'retry',
  'step-up-required': 'none',
  // The account state is re-fetched automatically (query-client); the account gate/home then show what is needed.
  'required-action': 'none',
  restricted: 'none',
  'feature-disabled': 'none',
  // P3.5: shown by the quote screen with its own reasons; the app-policy gate covers the other two.
  'service-area': 'none',
  'update-required': 'none',
  maintenance: 'retry',
  unavailable: 'retry',
  unknown: 'retry',
};

/** Maps any thrown value to user-safe copy; raw messages are never used. */
export function errorView(error: unknown): UiErrorView {
  const apiError = toApiError(error);
  const { kind } = apiError;
  if (kind === 'rate-limited') {
    const seconds = apiError.detail.retryAfterSeconds;
    return seconds === null
      ? { kind, messageKey: 'error.rateLimitedNoTime', action: 'retry' }
      : { kind, messageKey: 'error.rateLimited', params: { seconds }, action: 'retry' };
  }
  return { kind, messageKey: MESSAGE_BY_KIND[kind], action: ACTION_BY_KIND[kind] };
}

/** The subset of a TanStack Query result the adapters need (keeps them framework-independent and testable). */
export interface QuerySnapshot<D> {
  readonly status: 'pending' | 'error' | 'success';
  readonly data: D | undefined;
  readonly error: unknown;
}

export function viewStateFromQuery<D, T>(query: QuerySnapshot<D>, toModel: (data: D) => T, isEmpty: (model: T) => boolean = () => false): ViewState<T> {
  if (query.data !== undefined) {
    const model = toModel(query.data);
    if (isEmpty(model)) return { kind: 'empty' };
    return { kind: 'ready', data: model, stale: query.status === 'error' ? errorView(query.error) : null };
  }
  if (query.status === 'error') return { kind: 'error', error: errorView(query.error) };
  return { kind: 'loading' };
}

/** Combines two queries: the first error wins, otherwise loading until both have data. */
export function combineQueries<A, B>(a: QuerySnapshot<A>, b: QuerySnapshot<B>): QuerySnapshot<readonly [A, B]> {
  if (a.data !== undefined && b.data !== undefined) {
    const failed = a.status === 'error' ? a : b.status === 'error' ? b : null;
    return { status: failed ? 'error' : 'success', data: [a.data, b.data], error: failed?.error };
  }
  if (a.status === 'error' && a.data === undefined) return { status: 'error', data: undefined, error: a.error };
  if (b.status === 'error' && b.data === undefined) return { status: 'error', data: undefined, error: b.error };
  return { status: 'pending', data: undefined, error: null };
}
