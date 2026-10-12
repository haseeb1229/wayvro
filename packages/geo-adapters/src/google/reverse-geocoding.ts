/**
 * S1 Google — reverse geocoding (SKU REVERSE_GEOCODE, Geocoding API v3 `latlng`). The point is sent with at most
 * 5 decimals (privacy rule, evaluation §10). The first (most specific) result is used; ZERO_RESULTS ⇒ null.
 */
import type { GeoAdapterLicence, GeoLocale, GeoPoint, ResolvedPlace, ReverseGeocodingAdapter } from '@wayvro/provider-interfaces';
import { callContext, callJson, type CallContext } from '../http.js';
import { GOOGLE_TERMS, licence } from '../licences.js';
import { formatCoordinate, malformed, requirePoint } from '../normalise.js';
import { GEOCODING_URL, type GoogleAdapterOptions, geocodingV3Place, geocodingV3Results, googleLanguage } from './shared.js';

export class GoogleReverseGeocodingAdapter implements ReverseGeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: GoogleAdapterOptions) {
    this.ctx = callContext(options, 'REVERSE_GEOCODE');
    this.licences = [licence(this.ctx.providerKey, 'REVERSE_GEOCODE', GOOGLE_TERMS.REVERSE_GEOCODE)];
  }

  async reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null> {
    const point = requirePoint(this.ctx, input.point);
    const url = new URL(GEOCODING_URL);
    url.searchParams.set('latlng', `${formatCoordinate(point.lat, 5)},${formatCoordinate(point.lng, 5)}`);
    url.searchParams.set('language', googleLanguage(input.locale));
    url.searchParams.set('key', this.options.apiKey.reveal());
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const results = geocodingV3Results(this.ctx, res.body, res.status);
    const top = results[0];
    if (top === undefined) return null;
    const place = geocodingV3Place(top, input.locale);
    // A reverse answer for a Pakistan point that lies outside Pakistan is an impossible payload, not "no address".
    if (place === null) throw malformed(this.ctx, res.status);
    return place;
  }
}
