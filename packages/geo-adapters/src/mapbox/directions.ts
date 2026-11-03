/**
 * S2 Mapbox — Directions v5 `mapbox/driving` (SKU ROUTE): no alternatives, no steps, simplified GeoJSON overview.
 * `code: "NoRoute" | "NoSegment"` (HTTP 200) ⇒ NO_ROUTE; any other non-"Ok" code ⇒ PROVIDER_STATUS; a route without
 * a positive distance or a duration ⇒ INCOMPLETE_ROUTE. The traffic profile (`mapbox/driving-traffic` + `depart_at`)
 * is NOT used: its tier/terms are NF in the evaluation doc (conservative; revisit at P3.7 if S2 stays a candidate).
 */
import type { GeoAdapterLicence, GeoPoint, RouteInput, RouteResult, RoutingAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { MAPBOX_TERMS, licence } from '../licences.js';
import { MAX_ROUTE_VERTICES, malformed, parsePayload, requirePoint, routeNumbers, validateGeometry } from '../normalise.js';
import { MAPBOX_BASE, type MapboxAdapterOptions } from './shared.js';

const schema = z.object({
  code: z.string().max(60),
  routes: z
    .array(
      z.object({
        distance: z.number().optional(),
        duration: z.number().optional(),
        geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number(), z.number()])).max(MAX_ROUTE_VERTICES) }).optional(),
      }),
    )
    .max(5)
    .optional(),
});

const NO_ROUTE_CODES = new Set(['NoRoute', 'NoSegment']);

export class MapboxDirectionsAdapter implements RoutingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: MapboxAdapterOptions) {
    this.ctx = callContext(options, 'ROUTE');
    this.licences = [licence(this.ctx.providerKey, 'ROUTE', MAPBOX_TERMS.ROUTE)];
  }

  async route(input: RouteInput, signal: AbortSignal): Promise<RouteResult> {
    const o = requirePoint(this.ctx, input.origin);
    const d = requirePoint(this.ctx, input.destination);
    const url = new URL(`directions/v5/mapbox/driving/${o.lng},${o.lat};${d.lng},${d.lat}`, MAPBOX_BASE);
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'simplified');
    url.searchParams.set('access_token', this.options.accessToken.reveal());
    const res = await callJson(this.ctx, { method: 'GET', url }, signal);
    const payload = parsePayload(this.ctx, schema, res.body, res.status);
    if (NO_ROUTE_CODES.has(payload.code)) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'NO_ROUTE', res.status);
    if (payload.code !== 'Ok') throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'PROVIDER_STATUS', res.status);
    const route = payload.routes?.[0];
    if (route === undefined) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'NO_ROUTE', res.status);
    const numbers = routeNumbers(route.distance, route.duration);
    if (numbers === null) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'INCOMPLETE_ROUTE', res.status);
    const points: GeoPoint[] = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    const geometry = validateGeometry(points);
    if (geometry === null) throw malformed(this.ctx, res.status);
    return { ...numbers, geometry, confidence: 'UNKNOWN' };
  }
}
