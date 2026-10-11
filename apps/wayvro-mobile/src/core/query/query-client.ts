import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors';
import { backoffDelayMs } from '../api/retry';

/**
 * Server-state cache policy (P2.3). Reads are retried only when the failure is plausibly temporary (offline,
 * unavailable) and at most twice; 4xx answers (validation, conflict, session expiry, rate limits) are never retried
 * automatically. Mutations are never retried here: the API client already retries an unknown outcome with the same
 * idempotency key. Queries refetch when the app returns to the foreground (focusManager wired in the root layout).
 */
const MAX_QUERY_RETRIES = 2;

/** @internal exported for unit tests; used as the default query retry rule. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return error instanceof ApiError && (error.kind === 'offline' || error.kind === 'unavailable');
}

/**
 * A refusal that depends on account state (a required action is pending, or a restriction applies) means the cached
 * account state is stale: it is re-fetched so the account gate and home show what the server now requires.
 * @internal exported for unit tests
 */
export function needsAccountRefresh(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'required-action' || error.kind === 'restricted');
}

export function createQueryClient(random: () => number = Math.random): QueryClient {
  const refreshAccount = (error: unknown, isAccountQuery = false): void => {
    if (!isAccountQuery && needsAccountRefresh(error)) void client.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        refreshAccount(error, query.queryKey[0] === QUERY_KEYS.accountState[0] && query.queryKey[1] === QUERY_KEYS.accountState[1]);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        refreshAccount(error);
      },
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay: (attempt) => backoffDelayMs(attempt + 1, null, random),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}

export const QUERY_KEYS = {
  accountState: ['account', 'state'] as const,
  consents: ['account', 'consents'] as const,
  sessions: ['account', 'sessions'] as const,
  securityEvents: ['account', 'security-events'] as const,
  policies: (locale: 'en' | 'ur') => ['legal', 'policies', locale] as const,
  policyDocument: (policyKey: string, version: number, locale: 'en' | 'ur') => ['legal', 'policy', policyKey, version, locale] as const,
  agePolicy: ['legal', 'age-policy'] as const,
};
