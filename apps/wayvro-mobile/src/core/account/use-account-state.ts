import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '../query/query-client';
import { useServices } from '../services/ServicesProvider';

/** The authoritative account state (GET /v1/account/state); refetched on foreground and after every account mutation. */
export function useAccountState() {
  const { client } = useServices();
  return useQuery({ queryKey: QUERY_KEYS.accountState, queryFn: () => client.accountState() });
}
