import type { UiLocale } from '../../../core/i18n/strings';
import type { RequirementChecklist } from '../api/driver-api';

/**
 * Districts of per-district documents (R46). The ONLY source is the server's requirement checklist (`districts`: the
 * enabled districts of the application's city); the app never hard-codes a district. Names come from the server in
 * English and Urdu script: the Urdu-script name is shown in the Urdu (`ur`) UI, the English name otherwise (Roman Urdu
 * is written in Latin script), and the code when a name is missing or the district is not in the list.
 */

export type District = NonNullable<RequirementChecklist['districts']>[number];

export interface DistrictOption {
  readonly value: string;
  readonly label: string;
}

const nameFor = (locale: UiLocale, district: District): string => {
  const name = (locale === 'ur' ? district.nameUr : district.nameEn).trim();
  return name === '' ? district.code : name;
};

/** Display name of a district code; an unknown code (or no list) shows the code itself. */
export function districtName(locale: UiLocale, code: string, districts: readonly District[]): string {
  const district = districts.find((d) => d.code === code);
  return district === undefined ? code : nameFor(locale, district);
}

/** Picker options in the server's order. */
export function districtOptions(locale: UiLocale, districts: readonly District[]): readonly DistrictOption[] {
  return districts.map((d) => ({ value: d.code, label: nameFor(locale, d) }));
}
