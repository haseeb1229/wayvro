/**
 * S3 open stack — self-hosted routing (SKU ROUTE), car profile, no live traffic (engine property; ETA from the
 * road-speed profile only).
 *
 *  - OSRM `/route/v1/driving/{lng,lat;lng,lat}` (simplified GeoJSON overview). Errors arrive as HTTP 400 with a
 *    `code`: `NoRoute`/`NoSegment` ⇒ NO_ROUTE, other codes ⇒ CLIENT_ERROR.
 *  - Valhalla `/route?json=` (GET form documented in the API reference), `costing=auto`, kilometres, no narrative.
 *    `trip.summary.length` (km) ×1000 ⇒ metres; shape = polyline precision 6. HTTP 400 with internal error code
 *    170/171/442 (unconnected regions / no suitable edges / no path) ⇒ NO_ROUTE; other 400s ⇒ CLIENT_ERROR.
 */
import type { GeoAdapterLicence, GeoPoint, RouteInput, RouteResult, RoutingAdapter } from '@wayvro/provider-interfaces';
import { z } from 'zod';
import { GeoAdapterError } from '../errors.js';
import { callContext, callJson, type CallContext } from '../http.js';
import { OPEN_TERMS, licence } from '../licences.js';
import { MAX_POLYLINE_CHARS, MAX_ROUTE_VERTICES, decodePolyline, malformed, parsePayload, requirePoint, routeNumbers, validateGeometry } from '../normalise.js';
import type { SelfHostedAdapterOptions } from './shared.js';

const osrmSchema = z.object({
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

const OSRM_NO_ROUTE = new Set(['NoRoute', 'NoSegment']);

export class OsrmRoutingAdapter implements RoutingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: SelfHostedAdapterOptions) {
    this.ctx = callContext(options, 'ROUTE');
    this.licences = [licence(this.ctx.providerKey, 'ROUTE', OPEN_TERMS.ROUTE)];
  }

  async route(input: RouteInput, signal: AbortSignal): Promise<RouteResult> {
    const o = requirePoint(this.ctx, input.origin);
    const d = requirePoint(this.ctx, input.destination);
    const url = new URL(`route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}`, this.options.baseUrl);
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('overview', 'simplified');
    url.searchParams.set('geometries', 'geojson');
    const res = await callJson(this.ctx, { method: 'GET', url }, signal, [400]);
    const payload = parsePayload(this.ctx, osrmSchema, res.body, res.status);
    if (OSRM_NO_ROUTE.has(payload.code)) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'NO_ROUTE', res.status);
    if (payload.code !== 'Ok' || res.status !== 200) {
      throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', res.status === 400 ? 'CLIENT_ERROR' : 'PROVIDER_STATUS', res.status);
    }
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

const valhallaSchema = z.object({
  trip: z.object({
    units: z.string().max(20).optional(),
    summary: z.object({ length: z.number().optional(), time: z.number().optional() }),
    legs: z
      .array(z.object({ shape: z.string().max(MAX_POLYLINE_CHARS) }))
      .min(1)
      .max(5),
  }),
});
const valhallaErrorSchema = z.object({ error_code: z.number().int() });
const VALHALLA_NO_ROUTE = new Set([170, 171, 442]);

export class ValhallaRoutingAdapter implements RoutingAdapter {
  readonly licences: readonly GeoAdapterLicence[];
  private readonly ctx: CallContext;

  constructor(private readonly options: SelfHostedAdapterOptions) {
    this.ctx = callContext(options, 'ROUTE');
    this.licences = [licence(this.ctx.providerKey, 'ROUTE', OPEN_TERMS.ROUTE)];
  }

  async route(input: RouteInput, signal: AbortSignal): Promise<RouteResult> {
    const o = requirePoint(this.ctx, input.origin);
    const d = requirePoint(this.ctx, input.destination);
    const url = new URL('route', this.options.baseUrl);
    url.searchParams.set(
      'json',
      JSON.stringify({
        locations: [
          { lat: o.lat, lon: o.lng, type: 'break' },
          { lat: d.lat, lon: d.lng, type: 'break' },
        ],
        costing: 'auto',
        units: 'kilometers',
        directions_type: 'none',
      }),
    );
    const res = await callJson(this.ctx, { method: 'GET', url }, signal, [400]);
    if (res.status === 400) {
      const error = parsePayload(this.ctx, valhallaErrorSchema, res.body, res.status);
      throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', VALHALLA_NO_ROUTE.has(error.error_code) ? 'NO_ROUTE' : 'CLIENT_ERROR', res.status);
    }
    const payload = parsePayload(this.ctx, valhallaSchema, res.body, res.status);
    if (payload.trip.units !== undefined && payload.trip.units !== 'kilometers') throw malformed(this.ctx, res.status);
    const lengthKm = payload.trip.summary.length;
    const numbers = routeNumbers(lengthKm === undefined ? undefined : lengthKm * 1000, payload.trip.summary.time);
    if (numbers === null) throw new GeoAdapterError(this.ctx.providerKey, 'ROUTE', 'INCOMPLETE_ROUTE', res.status);
    const points: GeoPoint[] = [];
    for (const leg of payload.trip.legs) {
      const decoded = decodePolyline(leg.shape, 6);
      if (decoded === null) throw malformed(this.ctx, res.status);
      points.push(...decoded);
    }
    const geometry = validateGeometry(points);
    if (geometry === null) throw malformed(this.ctx, res.status);
    return { ...numbers, geometry, confidence: 'UNKNOWN' };
  }
}
