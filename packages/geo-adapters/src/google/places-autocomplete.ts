/**
 * S1 Google — Places API (New) Autocomplete (SKU AUTOCOMPLETE).
 * POST https://places.googleapis.com/v1/places:autocomplete, key in the `X-Goog-Api-Key` header, minimal field mask.
 * The provider receives: query text, language, region `pk`, the session token and (optionally) the gateway's coarse
 * 2-decimal bias cell — nothing else (no account, phone or installation id).
 */
import type { AutocompleteInput, GeoAdapterLicence, PlaceCandidate, PlacesAutocompleteAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { callContext, callJson, type CallContext } from '../http.js';
import { GOOGLE_TERMS, licence } from '../licences.js';
import { buildComponents, parsePayload, requireQueryText, requireSessionId } from '../normalise.js';
import { AUTOCOMPLETE_URL, GOOGLE_PLACE_ID, type GoogleAdapterOptions, googleKind, googleLanguage, str, tokens } from './shared.js';

/** Bias radius around the coarse cell (metres). City-scale; the centre is already rounded to 2 decimals by the gateway. */
const GOOGLE_AUTOCOMPLETE_BIAS_RADIUS_M = 10_000;
const FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types';

const schema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string().regex(GOOGLE_PLACE_ID),
            structuredFormat: z.object({ mainText: z.object({ text: str }), secondaryText: z.object({ text: str }).optional() }).optional(),
            text: z.object({ text: str }).optional(),
            types: tokens.optional(),
          })
          .optional(),
      }),
    )
    .max(10)
    .optional(),
});

export class GooglePlacesAutocompleteAdapter implements PlacesAutocompleteAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: GoogleAdapterOptions) {
    this.ctx = callContext(options, 'AUTOCOMPLETE');
    this.licences = [licence(this.ctx.providerKey, 'AUTOCOMPLETE', GOOGLE_TERMS.AUTOCOMPLETE)];
  }

  async suggest(input: AutocompleteInput, signal: AbortSignal): Promise<readonly PlaceCandidate[]> {
    const body: Record<string, unknown> = {
      input: requireQueryText(this.ctx, input.text),
      includedRegionCodes: ['pk'],
      regionCode: 'pk',
      languageCode: googleLanguage(input.locale),
      sessionToken: requireSessionId(this.ctx, input.searchSessionId),
    };
    if (input.biasCell !== null) {
      body['locationBias'] = {
        circle: { center: { latitude: input.biasCell.lat, longitude: input.biasCell.lng }, radius: GOOGLE_AUTOCOMPLETE_BIAS_RADIUS_M },
      };
    }
    const res = await callJson(
      this.ctx,
      {
        method: 'POST',
        url: new URL(AUTOCOMPLETE_URL),
        headers: { 'X-Goog-Api-Key': this.options.apiKey.reveal(), 'X-Goog-FieldMask': FIELD_MASK },
        body,
      },
      signal,
    );
    const payload = parsePayload(this.ctx, schema, res.body, res.status);
    const out: PlaceCandidate[] = [];
    for (const suggestion of payload.suggestions ?? []) {
      const p = suggestion.placePrediction;
      if (p === undefined) continue;
      const main = p.structuredFormat?.mainText.text ?? p.text?.text ?? null;
      // secondaryText is e.g. "<area>, <city>, Pakistan": only its first segment is used, as the area (no other parsing).
      const area = p.structuredFormat?.secondaryText?.text.split(',')[0] ?? null;
      out.push({
        providerPlaceId: p.placeId,
        components: buildComponents({ name: main, fineAreas: [area], city: null, locale: input.locale }),
        kind: googleKind(p.types ?? []),
      });
    }
    return out;
  }
}
