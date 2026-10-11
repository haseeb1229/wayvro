import type { TranslationParams } from '../../../core/i18n/strings';
import type { DriverStringKey } from '../i18n/driver-strings';
import { documentNameKey } from '../onboarding/document-names';

type Dt = (key: DriverStringKey, params?: TranslationParams) => string;

/** A document type's display name; unknown (future) types show their code instead of a guessed name. */
export function documentLabel(dt: Dt, documentType: string): string {
  const key = documentNameKey(documentType);
  return key === null ? dt('doc.unknown', { code: documentType }) : dt(key);
}

/** "Car in Lahore" style labels for eligibility rows; unknown cities show their code. */
export function cityLabel(dt: Dt, cityCode: string): string {
  return cityCode === 'LHR' ? dt('city.LHR') : cityCode;
}
