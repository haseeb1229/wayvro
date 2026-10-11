/**
 * Which claim fields the app OFFERS for a document, derived from SERVER facts (the checklist / compliance contracts:
 * `hasNumber`, `hasExpiry`, allowed licence classes). The server still validates every claim.
 */
export interface DocumentFieldHints {
  readonly number: boolean;
  readonly licenceClass: boolean;
  readonly issuedOn: boolean;
  readonly expiresOn: boolean;
}

interface ServerDocumentFacts {
  readonly documentType: string;
  readonly hasNumber: boolean;
  readonly hasExpiry: boolean;
}

/**
 * Presentational rule (the one exception): the CNIC number is entered once, in "Your details" (applicant claims), so
 * the CNIC document claim does not ask for it again even though the type has a number.
 */
const numberOffered = (facts: ServerDocumentFacts): boolean => facts.hasNumber && facts.documentType !== 'CNIC';

function hints(facts: ServerDocumentFacts, licenceClass: boolean): DocumentFieldHints {
  return {
    number: numberOffered(facts),
    licenceClass,
    // An issue date is recorded for documents that carry a number or an expiry (dated, issued documents).
    issuedOn: facts.hasNumber || facts.hasExpiry,
    expiresOn: facts.hasExpiry,
  };
}

/** A requirement checklist item: the licence class is offered when the requirement lists allowed classes. */
export function checklistFieldHints(item: ServerDocumentFacts & { readonly licenceClassesAllowed: readonly string[] }): DocumentFieldHints {
  return hints(item, item.licenceClassesAllowed.length > 0);
}

/** A renewal: the licence class is offered when the renewed document has one. */
export function renewalFieldHints(document: ServerDocumentFacts & { readonly licenceClass: string | null }): DocumentFieldHints {
  return hints(document, document.licenceClass !== null);
}
