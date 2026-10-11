import { describe, expect, it } from 'vitest';
import { POLICY_CATALOGUE } from './catalogue.js';
import { POLICY_KEYS, POLICY_LOCALES, changeLog, contentSha256, currentDocument, policyDocument, policyKeyForSlug, publishedDocuments } from './index.js';
import { PolicyCatalogueError, buildRegistry } from './registry.js';
import { PUBLISHED_CONTENT_HASHES } from './published-hashes.js';

describe('policy catalogue (A04/R09/W05)', () => {
  it('publishes every key in every locale with a locked, unique content hash', () => {
    const docs = publishedDocuments();
    for (const key of POLICY_KEYS) for (const locale of POLICY_LOCALES) expect(policyDocument(key, 1, locale)).toBeDefined();
    expect(Object.keys(PUBLISHED_CONTENT_HASHES)).toHaveLength(docs.length);
    for (const d of docs) {
      expect(PUBLISHED_CONTENT_HASHES[`${d.key}@${String(d.version)}:${d.locale}`]).toBe(d.contentSha256);
      expect(d.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(docs.map((d) => d.contentSha256)).size).toBe(docs.length);
  });

  it('a published text cannot change in place (immutability): any edit changes the hash', () => {
    const doc = policyDocument('TERMS', 1, 'en');
    if (!doc) throw new Error('TERMS v1 missing');
    const edited = { ...doc.body, sections: [...doc.body.sections, { heading: 'x', paragraphs: ['y'] }] };
    expect(contentSha256(edited)).not.toBe(doc.contentSha256);
    expect(contentSha256({ ...doc.body, title: `${doc.body.title} ` })).not.toBe(doc.contentSha256);
    expect(contentSha256(doc.body)).toBe(doc.contentSha256);
  });

  it('versions are increasing, effective dates are ordered, and approved versions name their approval', () => {
    for (const p of POLICY_CATALOGUE) {
      p.versions.forEach((v, i) => {
        expect(v.version).toBe(i + 1);
        if (i > 0) expect(Date.parse(v.effectiveAt)).toBeGreaterThanOrEqual(Date.parse(p.versions[i - 1]?.effectiveAt ?? ''));
        expect(Number.isNaN(Date.parse(v.effectiveAt))).toBe(false);
        if (v.status === 'APPROVED') expect(v.approvalRef).toMatch(/\S/);
        else expect(v.approvalRef).toBeNull();
      });
    }
    expect(new Set(POLICY_CATALOGUE.map((p) => p.slug)).size).toBe(POLICY_CATALOGUE.length);
  });

  it('placeholders say so in every locale (W05 banner) and make no forbidden claims', () => {
    for (const d of publishedDocuments()) {
      if (d.status !== 'PLACEHOLDER_NOT_FOR_PRODUCTION') continue;
      const first = d.body.sections[0]?.heading ?? '';
      expect(first).toMatch(d.locale === 'en' ? /PLACEHOLDER — NOT FOR PRODUCTION/ : /پروڈکشن کے لیے نہیں/);
    }
    const english = publishedDocuments()
      .filter((d) => d.locale === 'en')
      .map((d) => JSON.stringify(d.body))
      .join('\n');
    // No NADRA/government-verification claim, no "liveness passed", no gender inference, no invented age threshold.
    expect(english).not.toMatch(/NADRA|Verisys|liveness (passed|verified|check passed)/i);
    expect(english).not.toMatch(/\b(1[0-9]|2[0-9]) years? (old|of age)\b/i);
  });

  it('refuses an in-place edit of a locked text and resolves newer versions by effective date', () => {
    const terms = POLICY_CATALOGUE.find((p) => p.key === 'TERMS');
    const v1 = terms?.versions[0];
    if (!terms || !v1) throw new Error('TERMS missing');
    const edited = { ...terms, versions: [{ ...v1, body: { ...v1.body, en: { ...v1.body.en, title: 'Edited' } } }] };
    expect(() => buildRegistry([edited], PUBLISHED_CONTENT_HASHES)).toThrow(PolicyCatalogueError);
    // A second (material) version effective later: current() switches at its effective time; change log is newest first.
    const v2 = { ...v1, version: 2, effectiveAt: '2026-12-01T00:00:00.000Z', body: { en: { title: 'T2', sections: [] }, ur: { title: 'ٹی2', sections: [] } } };
    const two = { ...terms, versions: [v1, v2] };
    const lock = {
      ...PUBLISHED_CONTENT_HASHES,
      'TERMS@2:en': contentSha256(v2.body.en),
      'TERMS@2:ur': contentSha256(v2.body.ur),
    };
    const reg = buildRegistry([two], lock);
    expect(reg.current('TERMS', 'en', new Date('2026-11-30T00:00:00Z'))?.version).toBe(1);
    expect(reg.current('TERMS', 'en', new Date('2026-12-01T00:00:00Z'))?.version).toBe(2);
    expect(reg.changeLog('en').map((d) => d.version)).toEqual([2, 1]);
    const sameDay = buildRegistry([two, { ...two, key: 'PRIVACY' as const, slug: 'p', versions: [{ ...v2, version: 1, effectiveAt: v2.effectiveAt }] }], {
      ...lock,
      'PRIVACY@1:en': contentSha256(v2.body.en),
      'PRIVACY@1:ur': contentSha256(v2.body.ur),
    });
    expect(sameDay.changeLog('en').map((d) => `${d.key}${String(d.version)}`)).toEqual(['PRIVACY1', 'TERMS2', 'TERMS1']);
  });

  it('resolves the current version by effective date, the change log and slugs', () => {
    expect(currentDocument('PRIVACY', 'ur', new Date('2026-10-10T00:00:00Z'))?.version).toBe(1);
    expect(currentDocument('PRIVACY', 'en', new Date('2026-10-09T23:59:59Z'))).toBeUndefined();
    const log = changeLog('en');
    expect(log).toHaveLength(POLICY_KEYS.length);
    expect(log.every((d) => d.locale === 'en')).toBe(true);
    expect(policyKeyForSlug('identity-verification-notice')).toBe('BIOMETRIC_KYC_NOTICE');
    expect(policyKeyForSlug('nope')).toBeUndefined();
    expect(policyDocument('TERMS', 99, 'en')).toBeUndefined();
    expect(publishedDocuments().find((d) => d.key === 'TERMS')?.requiredFor).toEqual(['ACCOUNT']);
    expect(publishedDocuments().find((d) => d.key === 'BIOMETRIC_KYC_NOTICE')?.canonicalPath).toBe('/legal/identity-verification-notice/v1');
  });
});
