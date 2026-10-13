import type { DraftField } from '../flow/draft';

/** The focused field from the route param (`field=pickup|dropoff`); anything else focuses the drop-off ("Where to?"). */
export function searchFieldParam(param: string | string[] | undefined): DraftField {
  return param === 'pickup' ? 'pickup' : 'dropoff';
}

/** One spoken sentence per suggestion row: "Primary, secondary". */
export function suggestionLabel(primary: string, secondary: string | null): string {
  return secondary === null ? primary : `${primary}, ${secondary}`;
}
