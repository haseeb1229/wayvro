import { toApiError } from '../../../core/api/errors';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';
import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * User-safe error copy for the Driver/Partner flows: driver-specific refusals get their own explanation, everything
 * else uses the app-wide error views (offline, rate limit, session, conflict, feature switched off …). Raw server
 * messages are never shown.
 */
export type DriverErrorView =
  { readonly source: 'driver'; readonly key: DriverStringKey; readonly action: 'policies' | 'none' } | { readonly source: 'core'; readonly view: UiErrorView };

export function driverErrorView(error: unknown): DriverErrorView {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED') return { source: 'driver', key: 'driver.policiesRequired', action: 'policies' };
  return { source: 'core', view: errorView(apiError) };
}

/** Reason codes of a 409 refusal (itemised submission/renewal gaps); empty for any other error. */
export function refusalReasonCodes(error: unknown): readonly string[] {
  const apiError = toApiError(error);
  return apiError.kind === 'conflict' ? apiError.detail.reasonCodes : [];
}
