import type { PolicyDocument } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { policyList } from '../../../__mocks__/fixtures';
import { legalListModel, parsePolicyRouteParams, policyDocumentModel } from './legal';

describe('legal', () => {
  it('lists account and disclosure policies, never driver-application documents, with placeholder flags', () => {
    const items = legalListModel(policyList('en'));
    expect(items.map((i) => i.policyKey)).toEqual(['TERMS', 'PRIVACY', 'COMMUNITY_GUIDELINES']);
    expect(items.map((i) => i.placeholder)).toEqual([true, true, false]);
  });

  it('builds the document view with placeholder label and English-fallback marker', () => {
    const summary = policyList('en').policies[0]!;
    const doc: PolicyDocument = { ...summary, body: { title: 'Terms of Use', sections: [{ heading: 'One', paragraphs: ['A', 'B'] }] } };
    expect(policyDocumentModel(doc, false)).toEqual({
      title: 'Terms of Use',
      version: 1,
      effectiveAt: summary.effectiveAt,
      placeholder: true,
      shownInEnglish: true,
      sections: [{ heading: 'One', paragraphs: ['A', 'B'] }],
    });
    expect(policyDocumentModel({ ...doc, body: { ...doc.body, title: ' ' } }, true)).toMatchObject({ title: 'Terms', shownInEnglish: false });
  });

  it('validates untrusted route params', () => {
    expect(parsePolicyRouteParams({ policyKey: 'TERMS', version: '2', locale: 'ur' }, 'en')).toEqual({
      ok: true,
      policyKey: 'TERMS',
      version: 2,
      locale: 'ur',
    });
    expect(parsePolicyRouteParams({ policyKey: 'TERMS', version: '2' }, 'en')).toMatchObject({ locale: 'en' });
    for (const raw of [
      { policyKey: 'NOPE', version: '1' },
      { policyKey: 'TERMS', version: '0' },
      { policyKey: 'TERMS', version: '1e3' },
      { policyKey: ['TERMS'], version: '1' },
    ]) {
      expect(parsePolicyRouteParams(raw, 'en')).toEqual({ ok: false });
    }
  });
});
