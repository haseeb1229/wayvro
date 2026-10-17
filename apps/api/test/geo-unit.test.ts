/**
 * Geo gateway pure parts (no infrastructure): PROP-NORM, UNIT-FMT, UNIT-PLACEREF, failure classification, the
 * licence-bundle boot refusal (GEO_LICENCE_BINDING_REFUSED), the key-class boot check and BOOT-NEG (MOCK geo doubles
 * refused in staging/production). Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { FieldCipher, KeyRingError, localKeyRing } from '@wayvro/field-crypto';
import { createLogger } from '@wayvro/observability';
import { GeoProviderError, ProviderBindingError, bindProviders, type GeoAdapterLicence, type RoutingAdapter } from '@wayvro/provider-interfaces';
import { createGeoTestDoubles } from '@wayvro/provider-test-doubles';
import { captureLogs } from '@wayvro/test-support';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { composeApi } from '../src/composition.js';
import { loadApiConfig } from '../src/config.js';
import { cleanText, formatAddress } from '../src/geo/address-format.js';
import { composeGeo } from '../src/geo/module.js';
import { QUERY_MAX_CODE_POINTS, codePointLength, normaliseQuery } from '../src/geo/normalise.js';
import { PlaceRefError, PlaceRefSealer } from '../src/geo/place-ref.js';
import { classifyFailure } from '../src/geo/provider-call.js';

const SEED = 'synthetic-geo-unit-seed-00000000000000000';
// PR tier 500 runs; the manual full tier (.github/workflows/mobile-full.yml) sets WAYVRO_PROPERTY_RUNS=50000 (PHASE3_TEST_STRATEGY §5).
const NUM_RUNS = Number(process.env['WAYVRO_PROPERTY_RUNS'] ?? '500');

describe('PROP-NORM (search normalisation)', () => {
  const urdu = fc.string({ unit: fc.constantFrom(...'ابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنںوہھءیے'.split('')), minLength: 1, maxLength: 30 });

  it('is idempotent, bounded and never empties a query that has visible characters', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = normaliseQuery(s);
        expect(normaliseQuery(once)).toBe(once);
        expect(codePointLength(once)).toBeLessThanOrEqual(QUERY_MAX_CODE_POINTS);
        if (/[\p{L}\p{N}]/u.test(s.normalize('NFKC'))) expect(once.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('passes Urdu-script input through unchanged except whitespace', () => {
    fc.assert(
      fc.property(fc.array(urdu, { minLength: 1, maxLength: 3 }), fc.constantFrom(' ', '  ', '\t', '   '), (words, gap) => {
        expect(normaliseQuery(`${gap}${words.join(gap)}${gap}`)).toBe(words.join(' '));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('case-folds Latin, applies NFKC, strips invisible/bidi characters and edge punctuation, keeps ZWNJ', () => {
    expect(normaliseQuery('  LIBERTY​   Market!! ')).toBe('liberty market');
    expect(normaliseQuery('ＬＩＢＥＲＴＹ')).toBe('liberty');
    expect(normaliseQuery('‮abc‬')).toBe('abc');
    expect(normaliseQuery('"Gulberg III",')).toBe('gulberg iii');
    expect(normaliseQuery('!!!')).toBe('!!!');
    expect(normaliseQuery('می‌خواهم')).toBe('می‌خواهم');
    expect(codePointLength(normaliseQuery('a'.repeat(300)))).toBe(80);
  });
});

describe('UNIT-FMT (Lahore address formatter)', () => {
  const c = (over: Partial<Record<'name' | 'block' | 'society' | 'area' | 'city' | 'nameUrdu', string | null>>) => ({
    name: null,
    block: null,
    society: null,
    area: null,
    city: null,
    nameUrdu: null,
    ...over,
  });

  it('landmark present: landmark first, area and city below', () => {
    expect(formatAddress(c({ name: 'Liberty Market', society: 'Gulberg III', area: 'Gulberg', city: 'Lahore' }), 'en')).toEqual({
      primaryText: 'Liberty Market',
      secondaryText: 'Gulberg III, Gulberg, Lahore',
      landmarkText: 'Liberty Market',
    });
  });

  it('block + society only: "Block X, Society"', () => {
    expect(formatAddress(c({ block: 'Block Y', society: 'DHA Phase 3', area: 'Defence', city: 'Lahore' }), 'en')).toEqual({
      primaryText: 'Block Y, DHA Phase 3',
      secondaryText: 'Defence, Lahore',
      landmarkText: null,
    });
  });

  it('area only, deduplicated', () => {
    expect(formatAddress(c({ area: 'Model Town', city: 'Lahore' }), 'en')).toEqual({ primaryText: 'Model Town', secondaryText: 'Lahore', landmarkText: null });
    expect(formatAddress(c({ society: 'Model Town', area: 'model town', city: 'Lahore' }), 'en')?.secondaryText).toBe('Lahore');
  });

  it('Urdu name only when the provider supplied it, for the ur locale', () => {
    const comp = c({ name: 'Badshahi Mosque', nameUrdu: 'بادشاہی مسجد', area: 'Walled City', city: 'Lahore' });
    expect(formatAddress(comp, 'ur')?.primaryText).toBe('بادشاہی مسجد');
    expect(formatAddress(comp, 'en')?.primaryText).toBe('Badshahi Mosque');
    expect(formatAddress(c({ name: 'Packages Mall', city: 'Lahore' }), 'ur')?.primaryText).toBe('Packages Mall');
  });

  it('all missing ⇒ null (the client shows "Pinned location"); coordinates never become text; untrusted text is cleaned', () => {
    expect(formatAddress(c({}), 'en')).toBeNull();
    expect(formatAddress(c({ name: ' \u0000​ ' }), 'en')).toBeNull();
    expect(formatAddress(c({ city: 'Lahore' }), 'en')).toEqual({ primaryText: 'Lahore', secondaryText: null, landmarkText: null });
    expect(cleanText(`<b>x</b>\u0007 ${'y'.repeat(400)}`)?.length).toBe(200);
  });
});

describe('UNIT-PLACEREF', () => {
  const cipher = new FieldCipher(localKeyRing(SEED));
  const account = randomUUID();
  const claims = { providerKey: 'geo-a', sku: 'AUTOCOMPLETE' as const, placeId: 'syn-lhr-001', accountId: account, cityCode: 'LHR' };
  const reason = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      return e instanceof PlaceRefError ? e.reason : `unexpected ${String(e)}`;
    }
  };

  it('seal/open round trip; the token reveals neither the provider id nor the account', () => {
    const sealer = new PlaceRefSealer(cipher, 900);
    const token = sealer.seal(claims);
    expect(token).toMatch(/^pr1\.[A-Za-z0-9_-]{40,512}$/);
    expect(token.length).toBeLessThanOrEqual(400);
    const raw = Buffer.from(token.slice(4), 'base64url');
    expect(raw.includes(Buffer.from('syn-lhr-001'))).toBe(false);
    expect(raw.includes(Buffer.from(account))).toBe(false);
    expect(sealer.open(token, account)).toEqual(claims);
    // two seals of the same claims differ (fresh token id and nonce)
    expect(sealer.seal(claims)).not.toBe(token);
  });

  it('a bit flip in any byte is rejected as PLACE_REF_INVALID', () => {
    const sealer = new PlaceRefSealer(cipher, 900);
    const raw = Buffer.from(sealer.seal(claims).slice(4), 'base64url');
    for (let i = 0; i < raw.length; i++) {
      const flipped = Buffer.from(raw);
      flipped[i] = (flipped[i] ?? 0) ^ 0x01;
      expect(reason(() => sealer.open(`pr1.${flipped.toString('base64url')}`, account))).toBe('PLACE_REF_INVALID');
    }
    expect(reason(() => sealer.open('pr1.short', account))).toBe('PLACE_REF_INVALID');
    expect(reason(() => sealer.open(`pr1.${randomBytes(120).toString('base64url')}`, account))).toBe('PLACE_REF_INVALID');
  });

  it('a foreign account gets PLACE_REF_INVALID even for an expired token (no oracle); expiry is PLACE_REF_EXPIRED', () => {
    let now = new Date('2026-10-13T10:00:00Z');
    const sealer = new PlaceRefSealer(cipher, 900, () => now);
    const token = sealer.seal(claims);
    expect(reason(() => sealer.open(token, randomUUID()))).toBe('PLACE_REF_INVALID');
    now = new Date('2026-10-13T10:15:00Z');
    expect(reason(() => sealer.open(token, account))).toBe('PLACE_REF_EXPIRED');
    expect(reason(() => sealer.open(token, randomUUID()))).toBe('PLACE_REF_INVALID');
  });

  it('a token sealed under a key that has since been retired is rejected', () => {
    const v1 = new PlaceRefSealer(new FieldCipher(localKeyRing(SEED, 'place_refs.v1=ACTIVE')), 900);
    const token = v1.seal(claims);
    const rotated = new PlaceRefSealer(new FieldCipher(localKeyRing(SEED, 'place_refs.v1=DECRYPT_ONLY,place_refs.v2=ACTIVE')), 900);
    expect(rotated.open(token, account).placeId).toBe('syn-lhr-001'); // grace: still decryptable during rotation
    const retired = new PlaceRefSealer(new FieldCipher(localKeyRing(SEED, 'place_refs.v1=RETIRED,place_refs.v2=ACTIVE')), 900);
    expect(reason(() => retired.open(token, account))).toBe('PLACE_REF_INVALID');
  });

  it('refuses to seal over-long provider ids', () => {
    expect(() => new PlaceRefSealer(cipher, 900).seal({ ...claims, placeId: 'x'.repeat(201) })).toThrow(RangeError);
  });
});

describe('provider failure classification', () => {
  it('maps typed adapter errors, our own abort and connect codes; anything else is an upstream failure', () => {
    expect(classifyFailure(new GeoProviderError('QUOTA'), false)).toBe('QUOTA');
    expect(classifyFailure(new Error('x'), true)).toBe('TIMEOUT');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyFailure(abort, false)).toBe('TIMEOUT');
    expect(classifyFailure(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), false)).toBe('CONNECT');
    expect(classifyFailure(new Error('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), false)).toBe('CONNECT');
    expect(classifyFailure(new Error('upstream rejected request for canary'), false)).toBe('UPSTREAM');
    expect(classifyFailure('not an error', false)).toBe('UPSTREAM');
  });
});

describe('boot refusals (CONFIG-BUNDLE, key classes, BOOT-NEG)', () => {
  const googleOnlyRouting: RoutingAdapter = {
    licences: [
      {
        providerKey: 'geo-g',
        sku: 'ROUTE',
        requiresRenderer: 'google',
        maxCacheTtlSeconds: 0,
        cacheSharedAcrossUsers: false,
        geometryStorable: false,
        attributionCode: null,
        microUsdPerCall: 5000,
      } satisfies GeoAdapterLicence,
    ],
    route: () => Promise.reject(new GeoProviderError('UPSTREAM')),
  };

  it('a Google-only adapter with the text-first renderer refuses boot and logs GEO_LICENCE_BINDING_REFUSED', () => {
    const logs = captureLogs();
    const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
    const config = loadApiConfig({
      WAYVRO_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
      REDIS_URL: 'redis://127.0.0.1:1',
      WAYVRO_LOCAL_KEY_SEED: SEED,
    });
    expect(config.GEO_RENDERER_KIND).toBe('none');
    const deps = { config, log, providers: bindProviders('production', { routing: googleOnlyRouting }) } as unknown as Parameters<typeof composeGeo>[0];
    expect(() => composeGeo(deps)).toThrow(ProviderBindingError);
    expect(logs.text()).toContain('GEO_LICENCE_BINDING_REFUSED');
  });

  it('an explicit key spec without the place_refs / geo_cache classes refuses to compose the API', async () => {
    const config = loadApiConfig({
      WAYVRO_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
      REDIS_URL: 'redis://127.0.0.1:1',
      WAYVRO_LOCAL_KEY_SEED: SEED,
      WAYVRO_LOCAL_KEY_SPEC: 'contact.v1=ACTIVE,phone_lookup.v1=ACTIVE',
    });
    await expect(composeApi(config, createLogger({ service: 'api', env: 'test', level: 'fatal' }), { providers: bindProviders('test', {}) })).rejects.toThrow(
      KeyRingError,
    );
  });

  it.each(['staging', 'production'] as const)('BOOT-NEG: %s refuses the MOCK geo doubles (synthetic gazetteer, straight-line router)', (env) => {
    const d = createGeoTestDoubles();
    for (const binding of [
      { placesAutocomplete: d.placesAutocomplete },
      { geocoding: d.geocoding },
      { reverseGeocoding: d.reverseGeocoding },
      { routing: d.routing },
    ]) {
      expect(() => bindProviders(env, binding)).toThrow(/refusing to bind mock provider/);
    }
  });

  it('rejects invalid geo configuration values', () => {
    const base = { WAYVRO_ENV: 'test', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', REDIS_URL: 'redis://127.0.0.1:1', WAYVRO_LOCAL_KEY_SEED: SEED };
    expect(loadApiConfig({ ...base, GEO_RENDERER_KIND: 'google' }).GEO_RENDERER_KIND).toBe('google');
    expect(() => loadApiConfig({ ...base, GEO_RENDERER_KIND: 'apple' })).toThrow();
    expect(() => loadApiConfig({ ...base, GEO_CACHE_MAX_TTL_ROUTE_SECONDS: '601' })).toThrow();
    expect(() => loadApiConfig({ ...base, GEO_CONNECT_RETRIES: '2' })).toThrow();
    expect(() => loadApiConfig({ ...base, GEO_PLACE_REF_TTL_SECONDS: '30' })).toThrow();
  });
});
