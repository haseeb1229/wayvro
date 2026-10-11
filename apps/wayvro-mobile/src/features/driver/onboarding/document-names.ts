import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Display names of document types by code (copy only). Which fields and evidence a type has comes from the server
 * (checklist / compliance contracts); this module never decides that. Unknown (future) codes have no name and are
 * shown by their code.
 */
const NAMES: ReadonlyMap<string, DriverStringKey> = new Map<string, DriverStringKey>([
  ['CNIC', 'doc.CNIC'],
  ['SELFIE', 'doc.SELFIE'],
  ['DRIVING_LICENCE', 'doc.DRIVING_LICENCE'],
  ['POLICE_CHARACTER_CERTIFICATE', 'doc.POLICE_CHARACTER_CERTIFICATE'],
  ['VEHICLE_REGISTRATION', 'doc.VEHICLE_REGISTRATION'],
  ['ROUTE_PERMIT', 'doc.ROUTE_PERMIT'],
  ['FITNESS_CERTIFICATE', 'doc.FITNESS_CERTIFICATE'],
  ['THIRD_PARTY_INSURANCE', 'doc.THIRD_PARTY_INSURANCE'],
  ['TOKEN_TAX', 'doc.TOKEN_TAX'],
  ['PANIC_BUTTON_REGISTRATION', 'doc.PANIC_BUTTON_REGISTRATION'],
  ['AUTHORISED_USE_LETTER', 'doc.AUTHORISED_USE_LETTER'],
]);

/** Display name key; null for an unknown type (the screen shows its code as a reference). */
export function documentNameKey(documentType: string): DriverStringKey | null {
  return NAMES.get(documentType) ?? null;
}

/** @internal exported for unit tests */
export const KNOWN_DOCUMENT_TYPES: readonly string[] = [...NAMES.keys()];
