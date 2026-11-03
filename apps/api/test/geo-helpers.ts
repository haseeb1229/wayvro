/**
 * Geo integration helpers: a harness with the synthetic geo doubles bound and TEST seams for the two cross-module
 * dependencies that other Phase-3 modules provide (runtime-switch reader: release controls P3.4; service-area lookup:
 * catalog P3.1). The service-area box is a synthetic rectangle around central Lahore — not a zone, not survey data.
 */
import { RUNTIME_SWITCH_KEYS, type RuntimeSwitchReader } from '@wayvro/config';
import type { ProviderPorts } from '@wayvro/provider-interfaces';
import { createGeoTestDoubles, type GeoTestDoubleOptions, type GeoTestDoubles } from '@wayvro/provider-test-doubles';
import type { LightMyRequestResponse } from 'fastify';
import type { GeoSeams, ServiceAreaLookup } from '../src/geo/gateway.js';
import { bearer, startApi, type Harness, type HarnessOptions } from './support.js';

export class TestSwitches implements RuntimeSwitchReader {
  readonly stopped = new Set<string>();
  isStopped(key: string): Promise<boolean> {
    if (!RUNTIME_SWITCH_KEYS.includes(key)) return Promise.reject(new Error(`unknown runtime switch ${key}`));
    return Promise.resolve(this.stopped.has(key));
  }
}

/** Synthetic LHR service area: lat 31.40–31.65, lng 74.20–74.50 (test seam only). */
export class TestServiceArea implements ServiceAreaLookup {
  readonly calls: Array<{ cityCode: string; lat: number; lng: number }> = [];
  inServiceArea(cityCode: string, point: { lat: number; lng: number }): Promise<boolean> {
    this.calls.push({ cityCode, ...point });
    return Promise.resolve(cityCode === 'LHR' && point.lat >= 31.4 && point.lat <= 31.65 && point.lng >= 74.2 && point.lng <= 74.5);
  }
}

export interface GeoHarness {
  readonly h: Harness;
  readonly doubles: GeoTestDoubles;
  readonly switches: TestSwitches;
  readonly serviceArea: TestServiceArea;
}

export interface GeoHarnessOptions extends HarnessOptions {
  readonly doubleOptions?: GeoTestDoubleOptions;
  /** Which geo ports to bind (default: all four). */
  readonly bind?: ReadonlyArray<'placesAutocomplete' | 'geocoding' | 'reverseGeocoding' | 'routing'>;
  /** false = no seams (the lead's wiring point left open). */
  readonly seams?: boolean;
}

export async function startGeoApi(options: GeoHarnessOptions = {}): Promise<GeoHarness> {
  const doubles = createGeoTestDoubles(options.doubleOptions);
  const switches = new TestSwitches();
  const serviceArea = new TestServiceArea();
  const kinds = options.bind ?? ['placesAutocomplete', 'geocoding', 'reverseGeocoding', 'routing'];
  const providers: Partial<ProviderPorts> = Object.fromEntries(kinds.map((k) => [k, doubles[k]]));
  const seams: GeoSeams = { switches, serviceArea };
  const h = await startApi({ ...options, providers: { ...options.providers, ...providers }, ...(options.seams === false ? {} : { geoSeams: seams }) });
  return { h, doubles, switches, serviceArea };
}

export function geoGet(h: Harness, url: string, token: string | null): Promise<LightMyRequestResponse> {
  return h.inject({ method: 'GET', url, headers: token ? bearer(token) : {} });
}

export const SESSION = '0192f3a0-0000-7000-8000-00000000a001';

export function autocompleteUrl(q: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ cityCode: 'LHR', q, locale: 'en', session: SESSION, ...extra });
  return `/v1/geo/autocomplete?${p.toString()}`;
}

export function reverseUrl(lat: number, lng: number, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ cityCode: 'LHR', lat: String(lat), lng: String(lng), locale: 'en', ...extra });
  return `/v1/geo/reverse?${p.toString()}`;
}

export function placeUrl(placeRef: string): string {
  return `/v1/geo/places/${placeRef}?${new URLSearchParams({ session: SESSION, locale: 'en' }).toString()}`;
}

export function reasonCodes(res: LightMyRequestResponse): readonly string[] {
  return res.json<{ error?: { details?: { reasonCodes?: string[] } } }>().error?.details?.reasonCodes ?? [];
}
