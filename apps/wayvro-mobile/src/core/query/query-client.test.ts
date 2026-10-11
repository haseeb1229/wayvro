import { describe, expect, it } from 'vitest';
import { ApiError, UI_ERROR_KINDS } from '../api/errors';
import { createQueryClient, needsAccountRefresh, QUERY_KEYS, shouldRetryQuery } from './query-client';

describe('query retry policy', () => {
  it('retries only temporary failures, at most twice', () => {
    expect(shouldRetryQuery(0, new ApiError('offline'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError('unavailable'))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError('offline'))).toBe(false);
  });

  it('never retries 4xx-class outcomes or unknown errors', () => {
    for (const kind of UI_ERROR_KINDS.filter((k) => k !== 'offline' && k !== 'unavailable')) expect(shouldRetryQuery(0, new ApiError(kind)), kind).toBe(false);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false);
  });

  it('never retries mutations and refetches on foreground/reconnect', () => {
    const defaults = createQueryClient(() => 0).getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
  });
});

describe('account refresh on account-dependent refusals', () => {
  it('re-fetches the account state when a call is refused for a pending action or a restriction', async () => {
    expect(needsAccountRefresh(new ApiError('required-action', { code: 'WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED' }))).toBe(true);
    expect(needsAccountRefresh(new ApiError('restricted', { code: 'WAYVRO_E_ACCOUNT_RESTRICTED', reasonCodes: ['SYNTHETIC_REASON'] }))).toBe(true);
    expect(needsAccountRefresh(new ApiError('offline'))).toBe(false);

    const client = createQueryClient(() => 0);
    client.setQueryData(QUERY_KEYS.accountState, { synthetic: true });
    await client.query({ queryKey: QUERY_KEYS.sessions, queryFn: () => Promise.reject(new ApiError('restricted')), retry: false }).catch(() => undefined);
    expect(client.getQueryState(QUERY_KEYS.accountState)?.isInvalidated).toBe(true);
  });
});
