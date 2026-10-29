import { describe, expect, it } from 'vitest';
import type { ApiSpec } from '../../../core/api/wayvro-client';
import { createRiderApi, type SessionTransport } from './rider-api';

function fakeTransport() {
  const reads: ApiSpec<unknown>[] = [];
  const mutations: { intent: string; spec: ApiSpec<unknown> }[] = [];
  const transport: SessionTransport = {
    read: <T>(spec: ApiSpec<T>) => {
      reads.push(spec);
      return Promise.resolve(undefined as T);
    },
    mutate: <T>(intent: string, spec: ApiSpec<T>) => {
      mutations.push({ intent, spec });
      return Promise.resolve(undefined as T);
    },
  };
  return { transport, reads, mutations };
}

describe('rider API (session transport; server prices everything)', () => {
  it('autocomplete sends city, text, locale, the field session, a 2-decimal bias only when present, and the caller signal', async () => {
    const { transport, reads } = fakeTransport();
    const api = createRiderApi(transport);
    const signal = new AbortController().signal;
    await api.autocomplete({ q: 'Liberty', locale: 'en', session: 'sess', bias: { lat: 31.52, lng: 74.36 }, mode: 'SUGGEST', signal });
    await api.autocomplete({ q: 'Liberty Market Gulberg', locale: 'ur', session: 'sess', bias: null, mode: 'GEOCODE', signal });
    expect(reads[0]).toMatchObject({
      method: 'GET',
      path: '/v1/geo/autocomplete',
      query: { cityCode: 'LHR', q: 'Liberty', locale: 'en', session: 'sess', biasLat: '31.52', biasLng: '74.36' },
      signal,
    });
    expect(reads[0]?.query).not.toHaveProperty('mode');
    expect(reads[1]?.query).toEqual({ cityCode: 'LHR', q: 'Liberty Market Gulberg', locale: 'ur', session: 'sess', mode: 'GEOCODE' });
  });

  it('place resolution, reverse geocode and quote reads hit the contract paths', async () => {
    const { transport, reads } = fakeTransport();
    const api = createRiderApi(transport);
    await api.resolvePlace(`pr1.${'a'.repeat(40)}`, 'sess', 'en');
    await api.reverse({ lat: 31.52041, lng: 74.35875 }, 'en');
    await api.quoteGroup('0190a000-0000-7000-8000-0000000000b1', 'lite');
    expect(reads.map((r) => r.path)).toEqual([`/v1/geo/places/pr1.${'a'.repeat(40)}`, '/v1/geo/reverse', '/v1/quotes/0190a000-0000-7000-8000-0000000000b1']);
    expect(reads[1]?.query).toEqual({ cityCode: 'LHR', lat: '31.52041', lng: '74.35875', locale: 'en' });
    expect(reads[2]?.query).toEqual({ detail: 'lite' });
  });

  it('a price check is a mutation under its attempt (new attempt ⇒ new idempotency key) and sends only points', async () => {
    const { transport, mutations } = fakeTransport();
    const api = createRiderApi(transport);
    await api.createQuote('attempt-1', { lat: 31.5, lng: 74.3, placeRef: `pr1.${'a'.repeat(40)}` }, { lat: 31.6, lng: 74.4 }, 'full');
    await api.createQuote('attempt-2', { lat: 31.5, lng: 74.3 }, { lat: 31.6, lng: 74.4 }, 'lite');
    expect(mutations.map((m) => m.intent)).toEqual(['quote:attempt-1', 'quote:attempt-2']);
    expect(mutations[0]?.spec).toMatchObject({ method: 'POST', path: '/v1/quotes', query: { detail: 'full' } });
    expect(mutations[0]?.spec.body).toEqual({
      cityCode: 'LHR',
      pickup: { lat: 31.5, lng: 74.3, placeRef: `pr1.${'a'.repeat(40)}` },
      dropoff: { lat: 31.6, lng: 74.4 },
    });
    expect(JSON.stringify(mutations.map((m) => m.spec.body))).not.toMatch(/fare|total|distance|duration|price/i);
  });
});
