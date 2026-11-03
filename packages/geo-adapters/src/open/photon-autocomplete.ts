/**
 * S3 open stack — self-hosted Photon `/api` as autocomplete (SKU AUTOCOMPLETE). Results are restricted to the
 * Pakistan bbox; the bias cell (if any) is sent as `lat`/`lon`. Photon has no billing session: the session id is
 * validated but not sent. Each candidate's provider id is its OSM reference (`N123`, `W45`, `R6`), resolved by
 * `PhotonGeocodingAdapter.resolve` through self-hosted Nominatim `/lookup`; features without one are dropped.
 */
import type { AutocompleteInput, GeoAdapterLicence, PlaceCandidate, PlacesAutocompleteAdapter } from '@wayvro/provider-interfaces';
import { callContext, callJson, type CallContext } from '../http.js';
import { OPEN_TERMS, licence } from '../licences.js';
import { PAKISTAN_BBOX, parsePayload, requireQueryText, requireSessionId, toPoint } from '../normalise.js';
import {
  type SelfHostedAdapterOptions,
  photonCollectionSchema,
  photonComponents,
  photonInPakistan,
  photonKind,
  photonLanguage,
  photonOsmRef,
} from './shared.js';

export const PHOTON_BBOX_PARAM = `${PAKISTAN_BBOX.minLng},${PAKISTAN_BBOX.minLat},${PAKISTAN_BBOX.maxLng},${PAKISTAN_BBOX.maxLat}`;

export class PhotonAutocompleteAdapter implements PlacesAutocompleteAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: SelfHostedAdapterOptions) {
    this.ctx = callContext(options, 'AUTOCOMPLETE');
    this.licences = [licence(this.ctx.providerKey, 'AUTOCOMPLETE', OPEN_TERMS.AUTOCOMPLETE)];
  }

  async suggest(input: AutocompleteInput, signal: AbortSignal): Promise<readonly PlaceCandidate[]> {
    requireSessionId(this.ctx, input.searchSessionId);
    const url = new URL('api', this.options.baseUrl);
    url.searchParams.set('q', requireQueryText(this.ctx, input.text));
    url.searchParams.set('limit', '5');
    url.searchParams.set('bbox', PHOTON_BBOX_PARAM);
    const lang = photonLanguage(input.locale);
    if (lang !== null) url.searchParams.set('lang', lang);
    if (input.biasCell !== null) {
      url.searchParams.set('lat', String(input.biasCell.lat));
      url.searchParams.set('lon', String(input.biasCell.lng));
    }
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.ctx, photonCollectionSchema, res.body, res.status);
    const out: PlaceCandidate[] = [];
    for (const feature of payload.features) {
      const ref = photonOsmRef(feature);
      const [lng, lat] = feature.geometry.coordinates;
      if (ref === null || !photonInPakistan(feature) || toPoint(lat, lng) === null) continue;
      out.push({ providerPlaceId: ref, components: photonComponents(feature, input.locale), kind: photonKind(feature) });
    }
    return out;
  }
}
