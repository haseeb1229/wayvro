/**
 * S2 Mapbox — forward geocoding (SKU GEOCODE: Geocoding v6 `/forward`, `permanent=false` = temporary, uncacheable,
 * Mapbox-map-only) and place resolution (SKU PLACE_RESOLVE: Search Box `/retrieve/{mapbox_id}` with the same session
 * token as the preceding `/suggest`, which closes the billing session).
 *
 * `forwardAutocomplete` (default false) sets the v6 `autocomplete` flag. The SP-04 harness runs a second instance with
 * it enabled to measure the evaluation doc's "autocomplete via temporary geocoding" S2 variant; the API never needs it.
 */
import type { GeoAdapterLicence, GeoLocale, GeocodingAdapter, ResolvedPlace } from '@wayvro/provider-interfaces';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { MAPBOX_TERMS, licence } from '../licences.js';
import { malformed, parsePayload, requirePlaceId, requireQueryText, requireSessionId } from '../normalise.js';
import { MAPBOX_BASE, MAPBOX_ID, type MapboxAdapterOptions, featureCollectionSchema, featurePlace, mapboxLanguage } from './shared.js';

export interface MapboxGeocodingOptions extends MapboxAdapterOptions {
  readonly forwardAutocomplete?: boolean;
}

export class MapboxGeocodingAdapter implements GeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly geocodeCtx: CallContext;
  private readonly resolveCtx: CallContext;

  constructor(private readonly options: MapboxGeocodingOptions) {
    this.geocodeCtx = callContext(options, 'GEOCODE');
    this.resolveCtx = callContext(options, 'PLACE_RESOLVE');
    this.licences = [
      licence(this.geocodeCtx.providerKey, 'GEOCODE', MAPBOX_TERMS.GEOCODE),
      licence(this.geocodeCtx.providerKey, 'PLACE_RESOLVE', MAPBOX_TERMS.PLACE_RESOLVE),
    ];
  }

  async geocode(
    input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' },
    signal: AbortSignal,
  ): Promise<readonly ResolvedPlace[]> {
    const url = new URL('search/geocode/v6/forward', MAPBOX_BASE);
    url.searchParams.set('q', requireQueryText(this.geocodeCtx, input.text));
    url.searchParams.set('country', input.countryCode.toLowerCase());
    url.searchParams.set('limit', '5');
    url.searchParams.set('permanent', 'false');
    url.searchParams.set('autocomplete', this.options.forwardAutocomplete === true ? 'true' : 'false');
    const language = mapboxLanguage(input.locale);
    if (language !== null) url.searchParams.set('language', language);
    url.searchParams.set('access_token', this.options.accessToken.reveal());
    const res = await callJson(this.geocodeCtx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.geocodeCtx, featureCollectionSchema, res.body, res.status);
    return payload.features.map((f) => featurePlace(f, input.locale)).filter((p): p is ResolvedPlace => p !== null);
  }

  async resolve(
    input: { readonly providerPlaceId: string; readonly searchSessionId: string; readonly locale: GeoLocale },
    signal: AbortSignal,
  ): Promise<ResolvedPlace> {
    const id = requirePlaceId(this.resolveCtx, input.providerPlaceId, MAPBOX_ID);
    const url = new URL(`search/searchbox/v1/retrieve/${encodeURIComponent(id)}`, MAPBOX_BASE);
    url.searchParams.set('session_token', requireSessionId(this.resolveCtx, input.searchSessionId));
    const language = mapboxLanguage(input.locale);
    if (language !== null) url.searchParams.set('language', language);
    url.searchParams.set('access_token', this.options.accessToken.reveal());
    let res;
    try {
      res = await callJson(this.resolveCtx, { method: 'GET', url }, signal);
    } catch (error) {
      if (error instanceof GeoAdapterError && error.httpStatus === 404)
        throw new GeoAdapterError(this.resolveCtx.providerKey, 'PLACE_RESOLVE', 'NOT_FOUND', 404);
      throw error;
    }
    const payload = parsePayload(this.resolveCtx, featureCollectionSchema, res.body, res.status);
    const first = payload.features[0];
    if (first === undefined) throw new GeoAdapterError(this.resolveCtx.providerKey, 'PLACE_RESOLVE', 'NOT_FOUND', res.status);
    const place = featurePlace(first, input.locale);
    if (place === null) throw malformed(this.resolveCtx, res.status);
    return place;
  }
}
