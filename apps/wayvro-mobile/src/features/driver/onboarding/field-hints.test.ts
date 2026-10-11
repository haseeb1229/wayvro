import { describe, expect, it } from 'vitest';
import { checklistFieldHints, renewalFieldHints } from './field-hints';

const item = (documentType: string, hasNumber: boolean, hasExpiry: boolean, licenceClassesAllowed: readonly string[] = []) => ({
  documentType,
  hasNumber,
  hasExpiry,
  licenceClassesAllowed,
});

describe('claim-field hints derived from server document facts', () => {
  it('number ⇐ hasNumber, expiry ⇐ hasExpiry, issue date ⇐ either', () => {
    expect(checklistFieldHints(item('VEHICLE_REGISTRATION', true, false))).toEqual({ number: true, licenceClass: false, issuedOn: true, expiresOn: false });
    expect(checklistFieldHints(item('TOKEN_TAX', false, true))).toEqual({ number: false, licenceClass: false, issuedOn: true, expiresOn: true });
    expect(checklistFieldHints(item('SELFIE', false, false))).toEqual({ number: false, licenceClass: false, issuedOn: false, expiresOn: false });
    // A future type the app has never seen still gets exactly the server's fields.
    expect(checklistFieldHints(item('FUTURE_DOCUMENT', true, true))).toEqual({ number: true, licenceClass: false, issuedOn: true, expiresOn: true });
  });

  it('the CNIC number is never asked again on the document (it lives in "Your details")', () => {
    expect(checklistFieldHints(item('CNIC', true, true))).toEqual({ number: false, licenceClass: false, issuedOn: true, expiresOn: true });
    expect(renewalFieldHints({ documentType: 'CNIC', hasNumber: true, hasExpiry: true, licenceClass: null }).number).toBe(false);
  });

  it('licence class ⇐ allowed classes on the requirement item, or the renewed document having a class', () => {
    expect(checklistFieldHints(item('DRIVING_LICENCE', true, true, ['LTV'])).licenceClass).toBe(true);
    expect(checklistFieldHints(item('DRIVING_LICENCE', true, true, [])).licenceClass).toBe(false);
    expect(renewalFieldHints({ documentType: 'DRIVING_LICENCE', hasNumber: true, hasExpiry: true, licenceClass: 'LTV' })).toEqual({
      number: true,
      licenceClass: true,
      issuedOn: true,
      expiresOn: true,
    });
    expect(renewalFieldHints({ documentType: 'FITNESS_CERTIFICATE', hasNumber: true, hasExpiry: true, licenceClass: null }).licenceClass).toBe(false);
  });
});
