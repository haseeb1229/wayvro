/**
 * Provider binding guard (GR-05, I04, ADR-045). Production composition roots bind real adapters only; test doubles
 * are physically absent from deployable artefacts. As defence in depth, binding a branded test double outside
 * `local`/`test` still throws, so a misconfigured staging/production process refuses to start rather than silently
 * "succeeding" against a fake. Unbound providers fail loudly when used.
 */
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { isMockProvider } from './brand.js';
import type { GeoAdapter, GeoAdapterLicence, GeoRendererKind, GeoSku } from './geo-ports.js';
import { PROVIDER_KINDS, type ProviderKind, type ProviderPorts } from './ports.js';

export class ProviderBindingError extends Error {
  override readonly name = 'ProviderBindingError';
}

export interface ProviderRegistry {
  get<K extends ProviderKind>(kind: K): ProviderPorts[K];
  /** True when an implementation is bound; features with an unbound port answer `503 WAYVRO_E_DEPENDENCY_UNAVAILABLE`. */
  has(kind: ProviderKind): boolean;
  readonly bound: readonly ProviderKind[];
}

export function bindProviders(env: WayvroEnv, bindings: Partial<ProviderPorts>): ProviderRegistry {
  const mockAllowed = isNonProductionLike(env);
  for (const kind of PROVIDER_KINDS) {
    const impl = bindings[kind];
    if (impl !== undefined && isMockProvider(impl) && !mockAllowed) {
      throw new ProviderBindingError(`refusing to bind mock provider "${kind}" in WAYVRO_ENV=${env}`);
    }
  }
  return {
    bound: PROVIDER_KINDS.filter((k) => bindings[k] !== undefined),
    has: (kind) => bindings[kind] !== undefined,
    get(kind) {
      const impl = bindings[kind];
      if (impl === undefined) throw new ProviderBindingError(`provider "${kind}" is not bound in WAYVRO_ENV=${env}`);
      return impl;
    },
  };
}

export type GeoPortKind = 'placesAutocomplete' | 'geocoding' | 'reverseGeocoding' | 'routing';
export const GEO_PORT_KINDS: readonly GeoPortKind[] = ['placesAutocomplete', 'geocoding', 'reverseGeocoding', 'routing'];

/** The SKUs each geo port serves (a geocoding adapter serves forward geocoding AND place resolution). */
export const GEO_PORT_SKUS: Readonly<Record<GeoPortKind, readonly GeoSku[]>> = {
  placesAutocomplete: ['AUTOCOMPLETE'],
  geocoding: ['GEOCODE', 'PLACE_RESOLVE'],
  reverseGeocoding: ['REVERSE_GEOCODE'],
  routing: ['ROUTE'],
};

/** The licence-checked geo binding: one declared licence per bound SKU. */
export interface GeoBundle {
  readonly rendererKind: GeoRendererKind;
  /** Licence of the adapter bound for the SKU; undefined when that SKU's port is unbound (503 for that SKU). */
  licence(sku: GeoSku): GeoAdapterLicence | undefined;
  readonly boundSkus: readonly GeoSku[];
}

const PROVIDER_KEY = /^[a-z][a-z0-9-]{1,31}$/;
const ATTRIBUTION = /^[A-Z][A-Z0-9_]{1,40}$/;

/**
 * Licence-coherent geo binding (CON-P3-16; docs/phase3/PHASE3_ARCHITECTURE.md §6.1; threat model T3-22). Every bound
 * geo adapter must declare exactly one licence per SKU it serves, with a well-formed provider key, a non-negative
 * integer cache TTL and price, and `requiresRenderer` equal to `any` or to the configured renderer kind. With
 * `GEO_RENDERER_KIND=none` (text-first UI) only `any` content is accepted: Google/Mapbox geo content without their own
 * map — including pricing-only use of their routes — is refused (ARCH-03 lead decision; counsel confirmation EXTERNAL).
 * Throws `ProviderBindingError`; the composition root logs `GEO_LICENCE_BINDING_REFUSED` and refuses to start.
 */
export function assertGeoBundle(rendererKind: GeoRendererKind, registry: ProviderRegistry): GeoBundle {
  const bySku = new Map<GeoSku, GeoAdapterLicence>();
  for (const kind of GEO_PORT_KINDS) {
    if (!registry.has(kind)) continue;
    const adapter: GeoAdapter = registry.get(kind);
    const expected = GEO_PORT_SKUS[kind];
    const declared = new Set<GeoSku>();
    for (const l of adapter.licences) {
      const where = `geo adapter "${kind}" licence ${l.providerKey}/${l.sku}`;
      if (!expected.includes(l.sku)) throw new ProviderBindingError(`${where}: SKU not served by this port`);
      if (declared.has(l.sku)) throw new ProviderBindingError(`${where}: duplicate licence declaration`);
      declared.add(l.sku);
      if (!PROVIDER_KEY.test(l.providerKey)) throw new ProviderBindingError(`${where}: provider key must match ${PROVIDER_KEY.source}`);
      if (!Number.isSafeInteger(l.maxCacheTtlSeconds) || l.maxCacheTtlSeconds < 0) {
        throw new ProviderBindingError(`${where}: maxCacheTtlSeconds must be an integer >= 0`);
      }
      if (!Number.isSafeInteger(l.microUsdPerCall) || l.microUsdPerCall < 0)
        throw new ProviderBindingError(`${where}: microUsdPerCall must be an integer >= 0`);
      if (l.attributionCode !== null && !ATTRIBUTION.test(l.attributionCode)) throw new ProviderBindingError(`${where}: malformed attribution code`);
      if (l.requiresRenderer !== 'any' && l.requiresRenderer !== rendererKind) {
        throw new ProviderBindingError(
          `${where}: content requires the "${l.requiresRenderer}" renderer but GEO_RENDERER_KIND=${rendererKind} (licence coupling)`,
        );
      }
      bySku.set(l.sku, l);
    }
    const missing = expected.filter((s) => !declared.has(s));
    if (missing.length > 0) throw new ProviderBindingError(`geo adapter "${kind}" declares no licence for ${missing.join(', ')}`);
  }
  return { rendererKind, licence: (sku) => bySku.get(sku), boundSkus: [...bySku.keys()] };
}
