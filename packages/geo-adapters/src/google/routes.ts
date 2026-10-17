/**
 * S1 Google — Routes API computeRoutes (SKU ROUTE). Minimal field mask (distance, duration, overview polyline).
 * `TRAFFIC_UNAWARE` by default (Essentials price); `TRAFFIC_AWARE` only when configured, with `departureTime` sent only
 * when it lies in the future (the docs recommend it for traffic-aware requests only; past times are not documented —
 * conservative: omitted). A response without a route ⇒ NO_ROUTE; a route without a positive distance or a duration ⇒
 * INCOMPLETE_ROUTE (never defaulted; note proto3 JSON omits zero values, so a zero distance arrives as "missing").
 */
import type { GeoAdapterLicence, RouteInput, RouteResult, RoutingAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { GOOGLE_TERMS, licence } from '../licences.js';
import { MAX_POLYLINE_CHARS, decodePolyline, malformed, parsePayload, requirePoint, routeNumbers, validateGeometry } from '../normalise.js';
import { type GoogleAdapterOptions, ROUTES_URL, googleErrorReason } from './shared.js';

const FIELD_MASK = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

const schema = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().optional(),
        duration: z.string().max(32).optional(),
        polyline: z.object({ encodedPolyline: z.string().max(MAX_POLYLINE_CHARS) }).optional(),
      }),
    )
    .max(5)
    .optional(),
});

/**
 * Parses a protobuf JSON Duration such as "165s" or "12.5s"; null when malformed.
 * @internal exported for unit tests
 */
export function parseDurationSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^(\d{1,9})(\.\d{1,9})?s$/.exec(value);
  return m ? Number(`${m[1] ?? '0'}${m[2] ?? ''}`) : null;
}

export interface GoogleRoutesOptions extends GoogleAdapterOptions {
  readonly trafficAware: boolean;
}

export class GoogleRoutesAdapter implements RoutingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: GoogleRoutesOptions) {
    this.ctx = callContext(options, 'ROUTE');
    this.licences = [licence(this.ctx.providerKey, 'ROUTE', options.trafficAware ? GOOGLE_TERMS.ROUTE_PRO : GOOGLE_TERMS.ROUTE_ESSENTIALS)];
  }

  async route(input: RouteInput, signal: AbortSignal): Promise<RouteResult> {
    const origin = requirePoint(this.ctx, input.origin);
    const destination = requirePoint(this.ctx, input.destination);
    const body: Record<string, unknown> = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: this.options.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      units: 'METRIC',
      languageCode: 'en',
      regionCode: 'pk',
    };
    const now = this.ctx.now();
    if (this.options.trafficAware && input.departAt.getTime() > now.getTime()) body['departureTime'] = input.departAt.toISOString();
    const res = await callJson(
      this.ctx,
      {
        method: 'POST',
        url: new URL(ROUTES_URL),
        headers: { 'X-Goog-Api-Key': this.options.apiKey.reveal(), 'X-Goog-FieldMask': FIELD_MASK },
        body,
        errorReason: googleErrorReason,
      },
      signal,
    );
    const payload = parsePayload(this.ctx, schema, res.body, res.status);
    const route = payload.routes?.[0];
    if (route === undefined) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'NO_ROUTE', res.status);
    const numbers = routeNumbers(route.distanceMeters, parseDurationSeconds(route.duration));
    if (numbers === null) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'INCOMPLETE_ROUTE', res.status);
    const decoded = route.polyline === undefined ? null : decodePolyline(route.polyline.encodedPolyline, 5);
    const geometry = decoded === null ? null : validateGeometry(decoded);
    if (geometry === null) throw malformed(this.ctx, res.status);
    return { ...numbers, geometry, confidence: 'UNKNOWN' };
  }
}
