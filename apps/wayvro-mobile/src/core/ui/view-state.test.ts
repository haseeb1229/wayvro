import { describe, expect, it } from 'vitest';
import { ApiError, UI_ERROR_KINDS } from '../api/errors';
import { CATALOGUE } from '../i18n/strings';
import { combineQueries, errorView, viewStateFromQuery, type QuerySnapshot } from './view-state';

const pending: QuerySnapshot<number[]> = { status: 'pending', data: undefined, error: null };
const failed = (error: unknown): QuerySnapshot<number[]> => ({ status: 'error', data: undefined, error });
const success = (data: number[]): QuerySnapshot<number[]> => ({ status: 'success', data, error: null });

describe('view-state adapters', () => {
  it('maps loading, empty, ready and error', () => {
    const isEmpty = (m: number[]) => m.length === 0;
    expect(viewStateFromQuery(pending, (d) => d, isEmpty)).toEqual({ kind: 'loading' });
    expect(viewStateFromQuery(success([]), (d) => d, isEmpty)).toEqual({ kind: 'empty' });
    expect(viewStateFromQuery(success([1]), (d) => d, isEmpty)).toEqual({ kind: 'ready', data: [1], stale: null });
    expect(viewStateFromQuery(failed(new ApiError('offline')), (d) => d)).toEqual({
      kind: 'error',
      error: { kind: 'offline', messageKey: 'error.offline', action: 'retry' },
    });
  });

  it('distinguishes offline, session-expired and step-up states with the right action', () => {
    expect(errorView(new ApiError('session-expired'))).toEqual({ kind: 'session-expired', messageKey: 'error.sessionExpired', action: 'sign-in' });
    expect(errorView(new ApiError('step-up-required')).action).toBe('none');
    expect(errorView(new ApiError('rate-limited', { retryAfterSeconds: 30 }))).toEqual({
      kind: 'rate-limited',
      messageKey: 'error.rateLimited',
      params: { seconds: 30 },
      action: 'retry',
    });
    expect(errorView(new ApiError('rate-limited')).messageKey).toBe('error.rateLimitedNoTime');
  });

  it('never surfaces raw error text: unexpected errors become the generic message', () => {
    expect(errorView(new Error('SQL syntax error near users'))).toEqual({ kind: 'unknown', messageKey: 'error.unknown', action: 'retry' });
  });

  it('has catalogue copy for every error kind', () => {
    for (const kind of UI_ERROR_KINDS) expect(CATALOGUE.en[errorView(new ApiError(kind)).messageKey]).toBeTruthy();
  });

  it('shows cached data with a stale marker when a background refresh fails (partial success)', () => {
    const state = viewStateFromQuery({ status: 'error', data: [1], error: new ApiError('offline') }, (d) => d);
    expect(state).toEqual({ kind: 'ready', data: [1], stale: { kind: 'offline', messageKey: 'error.offline', action: 'retry' } });
  });

  it('combines queries: first error wins, loading until both have data', () => {
    expect(combineQueries(pending, success([1])).status).toBe('pending');
    expect(combineQueries(failed(new ApiError('offline')), pending).status).toBe('error');
    expect(combineQueries(success([1]), success([2]))).toEqual({ status: 'success', data: [[1], [2]], error: undefined });
    expect(combineQueries(success([1]), { status: 'error', data: [2], error: 'x' }).status).toBe('error');
  });
});
