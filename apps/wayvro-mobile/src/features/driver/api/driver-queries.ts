import { skipToken, useQuery } from '@tanstack/react-query';
import { useAccountState } from '../../../core/account/use-account-state';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useDriverApi } from '../upload/upload-service';

/** Query keys of the Driver/Partner flows (cleared with the whole cache on sign-out). */
export const DRIVER_KEYS = {
  application: QUERY_KEYS.driverApplication,
  requirements: (applicationId: string) => ['driver', 'requirements', applicationId] as const,
  evidence: (applicationId: string) => ['driver', 'evidence', applicationId] as const,
  compliance: ['driver', 'compliance'] as const,
};

/**
 * The current application — fetched only when the SERVER's account state says one exists (no 404 probing). `data` is
 * null when the account has none.
 */
export function useDriverApplication() {
  const api = useDriverApi();
  const account = useAccountState();
  const exists = account.data ? account.data.driver.application !== null : undefined;
  const application = useQuery({ queryKey: DRIVER_KEYS.application, queryFn: exists === true ? () => api.currentApplication() : skipToken });
  return { account, application, exists };
}

export function useRequirements(applicationId: string | null) {
  const api = useDriverApi();
  return useQuery({
    queryKey: DRIVER_KEYS.requirements(applicationId ?? 'none'),
    queryFn: applicationId === null ? skipToken : () => api.requirements(applicationId),
  });
}

export function useEvidence(applicationId: string | null) {
  const api = useDriverApi();
  return useQuery({
    queryKey: DRIVER_KEYS.evidence(applicationId ?? 'none'),
    queryFn: applicationId === null ? skipToken : () => api.evidence(applicationId),
  });
}

export function useCompliance() {
  const api = useDriverApi();
  return useQuery({ queryKey: DRIVER_KEYS.compliance, queryFn: () => api.compliance() });
}
