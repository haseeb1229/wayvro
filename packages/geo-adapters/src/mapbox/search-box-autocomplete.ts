/**
 * S2 Mapbox — Search Box API `/suggest` (SKU AUTOCOMPLETE; session-billed together with `/retrieve`).
 * The provider receives: query text, `country=pk`, limit 5, language (none for Urdu script), the session token and,
 * when the gateway supplies one, the coarse bias cell as `proximity`. Without a bias cell Mapbox defaults to IP
 * proximity, i.e. the Wayvro server's IP — no user data. Category/brand suggestions are not places (they cannot be
 * retrieved to a coordinate) and are dropped.
 */
import type { AutocompleteInput, GeoAdapterLicence, PlaceCandidate, PlacesAutocompleteAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { callContext, callJson, type CallContext } from '../http.js';
import { MAPBOX_TERMS, licence } from '../licences.js';
import { parsePayload, requireQueryText, requireSessionId } from '../normalise.js';
import { MAPBOX_BASE, MAPBOX_ID, type MapboxAdapterOptions, contextSchema, mapboxComponents, mapboxKind, mapboxLanguage, str } from './shared.js';

const NOT_A_PLACE = new Set(['category', 'brand']);

const schema = z.object({
  suggestions: z
    .array(
      z.object({
        name: str,
        mapbox_id: z.string().regex(MAPBOX_ID),
        feature_type: z.string().max(40),
        context: contextSchema.optional(),
      }),
    )
    .max(10),
});

export class MapboxSearchBoxAutocompleteAdapter implements PlacesAutocompleteAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: MapboxAdapterOptions) {
    this.ctx = callContext(options, 'AUTOCOMPLETE');
    this.licences = [licence(this.ctx.providerKey, 'AUTOCOMPLETE', MAPBOX_TERMS.AUTOCOMPLETE)];
  }

  async suggest(input: AutocompleteInput, signal: AbortSignal): Promise<readonly PlaceCandidate[]> {
    const url = new URL('search/searchbox/v1/suggest', MAPBOX_BASE);
    url.searchParams.set('q', requireQueryText(this.ctx, input.text));
    url.searchParams.set('session_token', requireSessionId(this.ctx, input.searchSessionId));
    url.searchParams.set('country', 'pk');
    url.searchParams.set('limit', '5');
    const language = mapboxLanguage(input.locale);
    if (language !== null) url.searchParams.set('language', language);
    if (input.biasCell !== null) url.searchParams.set('proximity', `${input.biasCell.lng},${input.biasCell.lat}`);
    url.searchParams.set('access_token', this.options.accessToken.reveal());
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.ctx, schema, res.body, res.status);
    return payload.suggestions
      .filter((s) => !NOT_A_PLACE.has(s.feature_type.toLowerCase()))
      .map((s) => ({ providerPlaceId: s.mapbox_id, components: mapboxComponents(s.name, s.context, input.locale), kind: mapboxKind(s.feature_type) }));
  }
}
