/**
 * S3 open stack — reverse geocoding (SKU REVERSE_GEOCODE) with either self-hosted Photon `/reverse` or self-hosted
 * Nominatim `/reverse` (`jsonv2`, `zoom=18`). SP-04 compares both. Points are sent with 5 decimals.
 *
 * Nominatim "no result": the 5.3.2 docs say the endpoint returns "exactly one result or an error" but do not document
 * the error body. Conservative reading: only the long-standing `{"error":"Unable to geocode"}` body means "no address"
 * (⇒ null); any other `error` body is a PROVIDER_STATUS failure.
 */
import type { GeoAdapterLicence, GeoLocale, GeoPoint, ResolvedPlace, ReverseGeocodingAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { OPEN_TERMS, licence } from '../licences.js';
import { formatCoordinate, malformed, parsePayload, requirePoint } from '../normalise.js';
import {
  type SelfHostedAdapterOptions,
  nominatimLanguage,
  nominatimPlace,
  nominatimPlaceSchema,
  photonCollectionSchema,
  photonLanguage,
  photonPlace,
} from './shared.js';

export class PhotonReverseGeocodingAdapter implements ReverseGeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: SelfHostedAdapterOptions) {
    this.ctx = callContext(options, 'REVERSE_GEOCODE');
    this.licences = [licence(this.ctx.providerKey, 'REVERSE_GEOCODE', OPEN_TERMS.REVERSE_GEOCODE)];
  }

  async reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null> {
    const point = requirePoint(this.ctx, input.point);
    const url = new URL('reverse', this.options.baseUrl);
    url.searchParams.set('lat', formatCoordinate(point.lat, 5));
    url.searchParams.set('lon', formatCoordinate(point.lng, 5));
    url.searchParams.set('limit', '1');
    const lang = photonLanguage(input.locale);
    if (lang !== null) url.searchParams.set('lang', lang);
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.ctx, photonCollectionSchema, res.body, res.status);
    const first = payload.features[0];
    if (first === undefined) return null;
    const place = photonPlace(first, input.locale);
    if (place === null) throw malformed(this.ctx, res.status);
    return place;
  }
}

const nominatimErrorSchema = z.object({ error: z.string().max(200) });
const NO_ADDRESS = 'Unable to geocode';

export class NominatimReverseGeocodingAdapter implements ReverseGeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: SelfHostedAdapterOptions) {
    this.ctx = callContext(options, 'REVERSE_GEOCODE');
    this.licences = [licence(this.ctx.providerKey, 'REVERSE_GEOCODE', OPEN_TERMS.REVERSE_GEOCODE)];
  }

  async reverse(input: { readonly point: GeoPoint; readonly locale: GeoLocale }, signal: AbortSignal): Promise<ResolvedPlace | null> {
    const point = requirePoint(this.ctx, input.point);
    const url = new URL('reverse', this.options.baseUrl);
    url.searchParams.set('lat', formatCoordinate(point.lat, 5));
    url.searchParams.set('lon', formatCoordinate(point.lng, 5));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '18');
    url.searchParams.set('accept-language', nominatimLanguage(input.locale));
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const error = nominatimErrorSchema.safeParse(res.body);
    if (error.success) {
      if (error.data.error === NO_ADDRESS) return null;
      throw new GeoAdapterError(this.ctx.providerKey, 'REVERSE_GEOCODE', 'PROVIDER_STATUS', res.status);
    }
    const payload = parsePayload(this.ctx, nominatimPlaceSchema, res.body, res.status);
    const place = nominatimPlace(payload, input.locale);
    if (place === null) throw malformed(this.ctx, res.status);
    return place;
  }
}
