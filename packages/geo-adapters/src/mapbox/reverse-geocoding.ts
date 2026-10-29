/**
 * S2 Mapbox — reverse geocoding (SKU REVERSE_GEOCODE: Geocoding v6 `/reverse`, temporary). Point sent with 5 decimals;
 * `limit=1`, `country=pk`. An empty `features` array ⇒ null (the docs show empty arrays for no-result batch queries;
 * the single-query empty case is not documented — conservative reading: empty means "no address").
 */
import type { GeoAdapterLicence, GeoLocale, GeoPoint, ResolvedPlace, ReverseGeocodingAdapter } from '@wayvro/provider-interfaces';
import { callContext, callJson, type CallContext } from '../http.js';
import { MAPBOX_TERMS, licence } from '../licences.js';
import { formatCoordinate, malformed, parsePayload, requirePoint } from '../normalise.js';
import { MAPBOX_BASE, type MapboxAdapterOptions, featureCollectionSchema, featurePlace, mapboxLanguage } from './shared.js';

export class MapboxReverseGeocodingAdapter implements ReverseGeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: MapboxAdapterOptions) {
    this.ctx = callContext(options, 'REVERSE_GEOCODE');
    this.licences = [licence(this.ctx.providerKey, 'REVERSE_GEOCODE', MAPBOX_TERMS.REVERSE_GEOCODE)];
  }

  async reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null> {
    const point = requirePoint(this.ctx, input.point);
    const url = new URL('search/geocode/v6/reverse', MAPBOX_BASE);
    url.searchParams.set('longitude', formatCoordinate(point.lng, 5));
    url.searchParams.set('latitude', formatCoordinate(point.lat, 5));
    url.searchParams.set('country', 'pk');
    url.searchParams.set('limit', '1');
    url.searchParams.set('permanent', 'false');
    const language = mapboxLanguage(input.locale);
    if (language !== null) url.searchParams.set('language', language);
    url.searchParams.set('access_token', this.options.accessToken.reveal());
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.ctx, featureCollectionSchema, res.body, res.status);
    const first = payload.features[0];
    if (first === undefined) return null;
    const place = featurePlace(first, input.locale);
    if (place === null) throw malformed(this.ctx, res.status);
    return place;
  }
}
