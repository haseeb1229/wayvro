/**
 * S3 open stack — forward geocoding with self-hosted Photon `/api` (SKU GEOCODE) and place resolution of Photon OSM
 * references through self-hosted Nominatim `/lookup` (SKU PLACE_RESOLVE; Photon has no lookup-by-id endpoint). Both
 * services must be built from the same Pakistan extract so references resolve; an unknown reference ⇒ NOT_FOUND.
 */
import type { GeoAdapterLicence, GeoLocale, GeocodingAdapter, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { OPEN_TERMS, licence } from '../licences.js';
import { malformed, parsePayload, requirePlaceId, requireQueryText } from '../normalise.js';
import { PHOTON_BBOX_PARAM } from './photon-autocomplete.js';
import {
  type SelfHostedAdapterOptions,
  nominatimLanguage,
  nominatimPlace,
  nominatimPlaceSchema,
  photonCollectionSchema,
  photonLanguage,
  photonPlace,
} from './shared.js';

const OSM_REF = /^[NWR][1-9]\d{0,15}$/;

export interface PhotonGeocodingOptions extends SelfHostedAdapterOptions {
  /** Self-hosted Nominatim used for `/lookup` of Photon OSM references. */
  readonly nominatimBaseUrl: URL;
}

export class PhotonGeocodingAdapter implements GeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly geocodeCtx: CallContext;
  private readonly resolveCtx: CallContext;

  constructor(private readonly options: PhotonGeocodingOptions) {
    this.geocodeCtx = callContext(options, 'GEOCODE');
    this.resolveCtx = callContext(options, 'PLACE_RESOLVE');
    this.licences = [
      licence(this.geocodeCtx.providerKey, 'GEOCODE', OPEN_TERMS.GEOCODE),
      licence(this.geocodeCtx.providerKey, 'PLACE_RESOLVE', OPEN_TERMS.PLACE_RESOLVE),
    ];
  }

  async geocode(
    input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' },
    signal: AbortSignal,
  ): Promise<readonly ResolvedPlace[]> {
    const url = new URL('api', this.options.baseUrl);
    url.searchParams.set('q', requireQueryText(this.geocodeCtx, input.text));
    url.searchParams.set('limit', '5');
    url.searchParams.set('bbox', PHOTON_BBOX_PARAM);
    const lang = photonLanguage(input.locale);
    if (lang !== null) url.searchParams.set('lang', lang);
    const res = await callJson(this.geocodeCtx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.geocodeCtx, photonCollectionSchema, res.body, res.status);
    return payload.features.map((f) => photonPlace(f, input.locale)).filter((p): p is ResolvedPlace => p !== null);
  }

  async resolve(
    input: { readonly providerPlaceId: string; readonly searchSessionId: string; readonly locale: GeoLocale },
    signal: AbortSignal,
  ): Promise<ResolvedPlace> {
    const ref = requirePlaceId(this.resolveCtx, input.providerPlaceId, OSM_REF);
    const url = new URL('lookup', this.options.nominatimBaseUrl);
    url.searchParams.set('osm_ids', ref);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', nominatimLanguage(input.locale));
    const res = await callJson(this.resolveCtx, { method: 'GET', url }, signal);
    const places = parsePayload(this.resolveCtx, z.array(nominatimPlaceSchema).max(5), res.body, res.status);
    const first = places[0];
    if (first === undefined) throw new GeoAdapterError(this.resolveCtx.providerKey, 'PLACE_RESOLVE', 'NOT_FOUND', res.status);
    const place = nominatimPlace(first, input.locale);
    if (place === null) throw malformed(this.resolveCtx, res.status);
    return place;
  }
}
