/**
 * Deterministic geo doubles (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §3.1; FAULT-GEO, docs/phase3/
 * PHASE3_TEST_STRATEGY.md §4.7). DEVELOPMENT/TEST ONLY (ADR-045): MOCK-branded, so `bindProviders()` refuses them
 * outside `local`/`test`, and absent from every deployable artefact (ART-ISO checks the provider key, the gazetteer
 * and the straight-line router by name).
 *
 * Everything here is SYNTHETIC: a small fixed gazetteer of public-landmark-level places around Lahore at ≤ 3 decimals
 * (no private address, no captured provider data), Roman-Urdu search spellings for alias tests, and a straight-line
 * router (great-circle distance × 1.3 detour factor at a flat 25 km/h). The router exists ONLY here: production never
 * estimates a route (CON-P3-08, threat model T3-13).
 *
 * Fault injection is per SKU and per instance: timeout (waits for the caller's abort), 5xx, connect error, malformed
 * values, slow drip, quota (429-equivalent), partial results (route without a duration, fewer suggestions, reverse
 * without locality), empty results and an error whose message echoes the request (the gateway must never log or return
 * it). A fault may be limited to the next N calls. Calls and the inputs the "provider" received are recorded.
 */
import {
  GeoProviderError,
  MOCK_PROVIDER,
  type AddressComponents,
  type AutocompleteInput,
  type GeoAdapterLicence,
  type GeoLocale,
  type GeoPoint,
  type GeoSku,
  type GeocodingAdapter,
  type MockBrand,
  type PlaceCandidate,
  type PlaceKind,
  type PlacesAutocompleteAdapter,
  type ResolvedPlace,
  type ReverseGeocodingAdapter,
  type RouteInput,
  type RouteResult,
  type RoutingAdapter,
} from '@wayvro/provider-interfaces';

export const GEO_MOCK_PROVIDER_KEY = 'geo-mock';

interface SyntheticPlace {
  readonly id: string;
  readonly kind: PlaceKind;
  readonly point: GeoPoint;
  readonly components: AddressComponents;
  /** Extra lower-case search spellings (Roman Urdu) the synthetic "provider" understands. Aliases are NOT listed. */
  readonly spellings: readonly string[];
}

const place = (id: string, kind: PlaceKind, lat: number, lng: number, c: Partial<AddressComponents>, spellings: readonly string[] = []): SyntheticPlace => ({
  id,
  kind,
  point: { lat, lng },
  components: { name: null, block: null, society: null, area: null, city: 'Lahore', nameUrdu: null, ...c },
  spellings,
});

/** SYNTHETIC gazetteer (coarse public-landmark points, ≤ 3 decimals; not survey data, not provider data). */
export const SYNTHETIC_GAZETTEER: readonly SyntheticPlace[] = [
  place('syn-lhr-001', 'LANDMARK', 31.51, 74.341, { name: 'Liberty Market', block: null, society: 'Gulberg III', area: 'Gulberg' }, ['liberty']),
  place('syn-lhr-002', 'LANDMARK', 31.588, 74.31, { name: 'Badshahi Mosque', area: 'Walled City', nameUrdu: 'بادشاہی مسجد' }, ['badshahi masjid']),
  place('syn-lhr-003', 'LANDMARK', 31.593, 74.309, { name: 'Minar-e-Pakistan', area: 'Iqbal Park', nameUrdu: 'مینار پاکستان' }, ['minar e pakistan']),
  place('syn-lhr-004', 'LANDMARK', 31.579, 74.304, { name: 'Data Darbar', area: 'Bhati Gate' }, ['data sahib']),
  place('syn-lhr-005', 'LANDMARK', 31.567, 74.31, { name: 'Anarkali Bazaar', area: 'Anarkali' }, ['anarkali']),
  place('syn-lhr-006', 'LANDMARK', 31.522, 74.404, { name: 'Allama Iqbal International Airport', area: 'Airport Road' }, ['airport', 'lahore airport']),
  place('syn-lhr-007', 'LANDMARK', 31.579, 74.336, { name: 'Lahore Railway Station', area: 'Landa Bazar' }, ['railway station', 'station']),
  place('syn-lhr-008', 'LANDMARK', 31.467, 74.266, { name: 'Emporium Mall', block: null, society: 'Johar Town', area: 'Johar Town' }, ['emporium']),
  place('syn-lhr-009', 'LANDMARK', 31.471, 74.356, { name: 'Packages Mall', area: 'Walton Road' }, ['packages']),
  place('syn-lhr-010', 'AREA', 31.483, 74.326, { name: null, block: null, society: 'Model Town', area: 'Model Town' }, ['model town']),
  place('syn-lhr-011', 'ADDRESS', 31.476, 74.383, { name: null, block: 'Block Y', society: 'DHA Phase 3', area: 'Defence' }, ['dha y block']),
  place('syn-lhr-012', 'LANDMARK', 31.513, 74.334, { name: 'Gaddafi Stadium', area: 'Gulberg' }, ['qadhafi stadium']),
  place('syn-lhr-013', 'LANDMARK', 31.504, 74.331, { name: 'Kalma Chowk', area: 'Gulberg' }, ['kalma chowk']),
  place('syn-lhr-014', 'LANDMARK', 31.567, 74.315, { name: 'Mall Road GPO Chowk', area: 'Mall Road' }, ['gpo chowk', 'mall road']),
];

export type GeoFaultMode =
  'NONE' | 'TIMEOUT' | 'UPSTREAM_5XX' | 'CONNECT_ERROR' | 'MALFORMED' | 'SLOW_DRIP' | 'QUOTA' | 'PARTIAL' | 'EMPTY' | 'ECHO_QUERY' | 'REJECTED_INPUT';

export interface GeoFault {
  readonly mode: GeoFaultMode;
  /** Apply to the next `times` calls only (default: until changed). */
  readonly times?: number;
  /** SLOW_DRIP: total time before the body completes (default 10 s). QUOTA: provider-advised retry seconds. */
  readonly delayMs?: number;
  readonly retryAfterSeconds?: number;
}

export interface GeoTestDoubleOptions {
  /** Terms-derived TTL per SKU the doubles declare (default 3600 s; 0 = "must not cache"). */
  readonly ttlSeconds?: Partial<Record<GeoSku, number>>;
  /** Price per call for budget accounting (default 1000 micro-USD). */
  readonly microUsdPerCall?: number;
  readonly providerKey?: string;
}

const SKUS: readonly GeoSku[] = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE'];
const DETOUR_FACTOR = 1.3;
const SYNTHETIC_SPEED_MPS = 25_000 / 3600;
const MAX_FAULT_WAIT_MS = 60_000;

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/** Resolves after `ms`, or rejects with an AbortError as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line synthetic route: great-circle × 1.3, 25 km/h. LOCAL/TEST ONLY — never an estimate in production. */
export function straightLineRoute(input: RouteInput): RouteResult {
  const distanceM = Math.max(1, Math.round(haversineMeters(input.origin, input.destination) * DETOUR_FACTOR));
  const mid = { lat: (input.origin.lat + input.destination.lat) / 2, lng: (input.origin.lng + input.destination.lng) / 2 };
  return { distanceM, durationS: Math.round(distanceM / SYNTHETIC_SPEED_MPS), geometry: [input.origin, mid, input.destination], confidence: 'LOW' };
}

function matches(p: SyntheticPlace, text: string): boolean {
  const q = text.toLocaleLowerCase('en').trim();
  if (q.length === 0) return false;
  const haystack = [p.components.name, p.components.society, p.components.area, p.components.block, p.components.city, ...p.spellings]
    .filter((s): s is string => s !== null)
    .map((s) => s.toLocaleLowerCase('en'));
  return haystack.some((h) => h.includes(q)) || (p.components.nameUrdu !== null && p.components.nameUrdu.includes(text.trim()));
}

class GeoDoubleState {
  readonly calls = new Map<GeoSku, number>();
  readonly inputs: Array<{ readonly sku: GeoSku; readonly input: unknown }> = [];
  private readonly faults = new Map<GeoSku, { fault: GeoFault; remaining: number }>();
  readonly licences: Readonly<Record<GeoSku, GeoAdapterLicence>>;

  constructor(options: GeoTestDoubleOptions) {
    const providerKey = options.providerKey ?? GEO_MOCK_PROVIDER_KEY;
    this.licences = Object.fromEntries(
      SKUS.map((sku) => [
        sku,
        {
          providerKey,
          sku,
          requiresRenderer: 'any',
          maxCacheTtlSeconds: options.ttlSeconds?.[sku] ?? 3600,
          cacheSharedAcrossUsers: true,
          geometryStorable: true,
          attributionCode: 'SYNTHETIC_DATA',
          microUsdPerCall: options.microUsdPerCall ?? 1000,
        } satisfies GeoAdapterLicence,
      ]),
    ) as Record<GeoSku, GeoAdapterLicence>;
  }

  setFault(sku: GeoSku | 'ALL', fault: GeoFault): void {
    for (const s of sku === 'ALL' ? SKUS : [sku]) this.faults.set(s, { fault, remaining: fault.times ?? Number.POSITIVE_INFINITY });
  }

  clearFaults(): void {
    this.faults.clear();
  }

  /** Records the call and returns the fault mode that applies to it. */
  begin(sku: GeoSku, input: unknown): GeoFault {
    this.calls.set(sku, (this.calls.get(sku) ?? 0) + 1);
    this.inputs.push({ sku, input });
    const f = this.faults.get(sku);
    if (!f || f.remaining <= 0) return { mode: 'NONE' };
    f.remaining--;
    return f.fault;
  }

  /** Applies the failure-type faults (the value-shaping ones are handled by each port). */
  async fail(fault: GeoFault, signal: AbortSignal, echo: string): Promise<void> {
    switch (fault.mode) {
      case 'TIMEOUT':
        await wait(MAX_FAULT_WAIT_MS, signal);
        throw new GeoProviderError('TIMEOUT');
      case 'SLOW_DRIP':
        await wait(fault.delayMs ?? 10_000, signal);
        return;
      case 'UPSTREAM_5XX':
        throw new GeoProviderError('UPSTREAM');
      case 'CONNECT_ERROR':
        throw new GeoProviderError('CONNECT');
      case 'QUOTA':
        throw new GeoProviderError('QUOTA', fault.retryAfterSeconds);
      case 'REJECTED_INPUT':
        throw new GeoProviderError('REJECTED_INPUT');
      case 'ECHO_QUERY':
        // a vendor error that echoes the request: the gateway must map it to a stable code and never log it
        throw new Error(`upstream rejected request for ${echo}`);
      default:
        return;
    }
  }
}

const resolved = (p: SyntheticPlace): ResolvedPlace => ({ point: p.point, components: p.components, kind: p.kind, confidence: 'MEDIUM' });

class AutocompleteDouble implements PlacesAutocompleteAdapter, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly licences: readonly GeoAdapterLicence[];
  constructor(private readonly state: GeoDoubleState) {
    this.licences = [state.licences.AUTOCOMPLETE];
  }
  async suggest(input: AutocompleteInput, signal: AbortSignal): Promise<readonly PlaceCandidate[]> {
    const fault = this.state.begin('AUTOCOMPLETE', input);
    await this.state.fail(fault, signal, input.text);
    if (fault.mode === 'EMPTY') return [];
    const hits = SYNTHETIC_GAZETTEER.filter((p) => matches(p, input.text)).map((p) => ({ providerPlaceId: p.id, components: p.components, kind: p.kind }));
    if (fault.mode === 'MALFORMED') return hits.map((h) => ({ ...h, providerPlaceId: '' }));
    return fault.mode === 'PARTIAL' ? hits.slice(0, 1) : hits.slice(0, 8);
  }
}

class GeocodingDouble implements GeocodingAdapter, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly licences: readonly GeoAdapterLicence[];
  constructor(private readonly state: GeoDoubleState) {
    this.licences = [state.licences.GEOCODE, state.licences.PLACE_RESOLVE];
  }
  async geocode(
    input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' },
    signal: AbortSignal,
  ): Promise<readonly ResolvedPlace[]> {
    const fault = this.state.begin('GEOCODE', input);
    await this.state.fail(fault, signal, input.text);
    if (fault.mode === 'EMPTY') return [];
    const hits = SYNTHETIC_GAZETTEER.filter((p) => matches(p, input.text)).map(resolved);
    if (fault.mode === 'MALFORMED') return hits.map((h) => ({ ...h, point: { lat: 51.5, lng: Number.NaN } }));
    return fault.mode === 'PARTIAL' ? hits.slice(0, 1) : hits.slice(0, 5);
  }
  async resolve(
    input: { readonly providerPlaceId: string; readonly searchSessionId: string; readonly locale: GeoLocale },
    signal: AbortSignal,
  ): Promise<ResolvedPlace> {
    const fault = this.state.begin('PLACE_RESOLVE', input);
    await this.state.fail(fault, signal, input.providerPlaceId);
    const p = SYNTHETIC_GAZETTEER.find((x) => x.id === input.providerPlaceId);
    if (!p || fault.mode === 'EMPTY') throw new GeoProviderError('REJECTED_INPUT');
    if (fault.mode === 'MALFORMED') return { ...resolved(p), point: { lat: 48.85, lng: 2.35 } };
    return resolved(p);
  }
}

class ReverseDouble implements ReverseGeocodingAdapter, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly licences: readonly GeoAdapterLicence[];
  constructor(private readonly state: GeoDoubleState) {
    this.licences = [state.licences.REVERSE_GEOCODE];
  }
  async reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null> {
    const fault = this.state.begin('REVERSE_GEOCODE', input);
    await this.state.fail(fault, signal, `${String(input.point.lat)},${String(input.point.lng)}`);
    if (fault.mode === 'EMPTY') return null;
    let best: { p: SyntheticPlace; d: number } | null = null;
    for (const p of SYNTHETIC_GAZETTEER) {
      const d = haversineMeters(input.point, p.point);
      if (!best || d < best.d) best = { p, d };
    }
    if (!best || best.d > 1500) return null;
    const near = best.d <= 150;
    const components: AddressComponents = {
      ...best.p.components,
      name: near ? best.p.components.name : null,
      nameUrdu: near ? best.p.components.nameUrdu : null,
    };
    if (fault.mode === 'MALFORMED') return { point: { lat: -95, lng: 74.3 }, components, kind: best.p.kind, confidence: 'LOW' };
    if (fault.mode === 'PARTIAL') {
      return { point: input.point, components: { ...components, area: null, city: null, society: null }, kind: 'OTHER', confidence: 'LOW' };
    }
    return { point: input.point, components, kind: near ? best.p.kind : 'AREA', confidence: near ? 'MEDIUM' : 'LOW' };
  }
}

class RoutingDouble implements RoutingAdapter, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly licences: readonly GeoAdapterLicence[];
  constructor(private readonly state: GeoDoubleState) {
    this.licences = [state.licences.ROUTE];
  }
  async route(input: RouteInput, signal: AbortSignal): Promise<RouteResult> {
    const fault = this.state.begin('ROUTE', input);
    await this.state.fail(fault, signal, `${String(input.origin.lat)},${String(input.origin.lng)}`);
    const r = straightLineRoute(input);
    if (fault.mode === 'EMPTY') throw new GeoProviderError('UPSTREAM');
    if (fault.mode === 'MALFORMED') return { ...r, distanceM: -r.distanceM, geometry: [{ lat: 10, lng: 10 }] };
    // a route without a duration: the gateway must refuse it, never invent an ETA (FG-06)
    if (fault.mode === 'PARTIAL') return { ...r, durationS: Number.NaN };
    return r;
  }
}

export interface GeoTestDoubles {
  readonly placesAutocomplete: PlacesAutocompleteAdapter & MockBrand;
  readonly geocoding: GeocodingAdapter & MockBrand;
  readonly reverseGeocoding: ReverseGeocodingAdapter & MockBrand;
  readonly routing: RoutingAdapter & MockBrand;
  /** Test control: fault injection and call/input recording (shared by the four doubles). */
  readonly control: {
    setFault(sku: GeoSku | 'ALL', fault: GeoFault): void;
    clearFaults(): void;
    calls(sku: GeoSku): number;
    inputs(sku: GeoSku): readonly unknown[];
    reset(): void;
  };
}

/** The four MOCK-branded geo doubles sharing one fault/recording state. */
export function createGeoTestDoubles(options: GeoTestDoubleOptions = {}): GeoTestDoubles {
  const state = new GeoDoubleState(options);
  return {
    placesAutocomplete: new AutocompleteDouble(state),
    geocoding: new GeocodingDouble(state),
    reverseGeocoding: new ReverseDouble(state),
    routing: new RoutingDouble(state),
    control: {
      setFault: (sku, fault) => {
        state.setFault(sku, fault);
      },
      clearFaults: () => {
        state.clearFaults();
      },
      calls: (sku) => state.calls.get(sku) ?? 0,
      inputs: (sku) => state.inputs.filter((i) => i.sku === sku).map((i) => i.input),
      reset: () => {
        state.clearFaults();
        state.calls.clear();
        state.inputs.length = 0;
      },
    },
  };
}
