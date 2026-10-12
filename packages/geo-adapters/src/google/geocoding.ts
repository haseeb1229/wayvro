/**
 * S1 Google — forward geocoding (SKU GEOCODE, Geocoding API v3 JSON) and place resolution (SKU PLACE_RESOLVE,
 * Place Details (New) with the Essentials-only field mask `id,location,addressComponents,types`).
 *
 * Conservative choices (see SOURCES.md):
 *  - Geocoding v3 is used because its request/response/status contract is fully documented; v4 is GA but its forward
 *    endpoint template and empty-result representation were not fully documented on the pages read (2026-10-13).
 *    v3 takes the key as a `key` query parameter, so outbound URLs are never logged or put into errors (T3-20).
 *  - `displayName` is NOT requested: it triggers the Place Details Pro SKU. The place name comes from address
 *    components when Google supplies a point-of-interest component; otherwise it stays null (never invented).
 *  - `components=country:PK` restricts forward geocoding to Pakistan.
 */
import type { GeoAdapterLicence, GeoLocale, GeocodingAdapter, ResolvedPlace } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { GOOGLE_TERMS, licence } from '../licences.js';
import { parsePayload, malformed, requirePlaceId, requireQueryText, requireSessionId, toPoint } from '../normalise.js';
import {
  GEOCODING_URL,
  GOOGLE_PLACE_ID,
  type GoogleAdapterOptions,
  PLACES_BASE,
  geocodingV3Place,
  geocodingV3Results,
  googleComponents,
  googleKind,
  googleLanguage,
  str,
  tokens,
} from './shared.js';

const DETAILS_FIELD_MASK = 'id,location,addressComponents,types';

const detailsSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  addressComponents: z
    .array(z.object({ longText: str, shortText: str.optional(), types: tokens }))
    .max(40)
    .optional(),
  types: tokens.optional(),
});

export class GoogleGeocodingAdapter implements GeocodingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly geocodeCtx: CallContext;
  private readonly resolveCtx: CallContext;

  constructor(private readonly options: GoogleAdapterOptions) {
    this.geocodeCtx = callContext(options, 'GEOCODE');
    this.resolveCtx = callContext(options, 'PLACE_RESOLVE');
    this.licences = [
      licence(this.geocodeCtx.providerKey, 'GEOCODE', GOOGLE_TERMS.GEOCODE),
      licence(this.geocodeCtx.providerKey, 'PLACE_RESOLVE', GOOGLE_TERMS.PLACE_RESOLVE),
    ];
  }

  async geocode(
    input: { readonly text: string; readonly locale: GeoLocale; readonly countryCode: 'PK' },
    signal: AbortSignal,
  ): Promise<readonly ResolvedPlace[]> {
    const url = new URL(GEOCODING_URL);
    url.searchParams.set('address', requireQueryText(this.geocodeCtx, input.text));
    url.searchParams.set('components', `country:${input.countryCode}`);
    url.searchParams.set('region', 'pk');
    url.searchParams.set('language', googleLanguage(input.locale));
    url.searchParams.set('key', this.options.apiKey.reveal());
    const res = await callJson(this.geocodeCtx, { method: 'GET', url }, signal);
    const out: ResolvedPlace[] = [];
    for (const result of geocodingV3Results(this.geocodeCtx, res.body, res.status)) {
      const place = geocodingV3Place(result, input.locale);
      if (place !== null) out.push(place);
    }
    return out;
  }

  async resolve(
    input: { readonly providerPlaceId: string; readonly searchSessionId: string; readonly locale: GeoLocale },
    signal: AbortSignal,
  ): Promise<ResolvedPlace> {
    const id = requirePlaceId(this.resolveCtx, input.providerPlaceId, GOOGLE_PLACE_ID);
    const url = new URL(`places/${id}`, PLACES_BASE);
    url.searchParams.set('languageCode', googleLanguage(input.locale));
    url.searchParams.set('regionCode', 'pk');
    url.searchParams.set('sessionToken', requireSessionId(this.resolveCtx, input.searchSessionId));
    let res;
    try {
      res = await callJson(
        this.resolveCtx,
        { method: 'GET', url, headers: { 'X-Goog-Api-Key': this.options.apiKey.reveal(), 'X-Goog-FieldMask': DETAILS_FIELD_MASK } },
        signal,
      );
    } catch (error) {
      if (error instanceof GeoAdapterError && error.httpStatus === 404)
        throw new GeoAdapterError(this.resolveCtx.providerKey, 'PLACE_RESOLVE', 'NOT_FOUND', 404);
      throw error;
    }
    const payload = parsePayload(this.resolveCtx, detailsSchema, res.body, res.status);
    const point = toPoint(payload.location.latitude, payload.location.longitude);
    if (point === null) throw malformed(this.resolveCtx, res.status);
    const components = (payload.addressComponents ?? []).map((c) => ({ text: c.longText, types: c.types }));
    return { point, components: googleComponents(components, input.locale), kind: googleKind(payload.types ?? []), confidence: 'UNKNOWN' };
  }
}
