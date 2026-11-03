/**
 * OpenTelemetry bootstrap. Must run before the instrumented framework is imported (see each app's `main.ts`).
 * Without `OTEL_EXPORTER_OTLP_ENDPOINT` nothing is exported (local default); traces never carry PII attributes.
 *
 * No HTTP auto-instrumentation is registered (the SDK is started without instrumentations), so no span records a
 * request URL today. Defence in depth for when one is added (Phase 3 P3.2, ARCH-01, threat model T3-28): the exporter
 * is wrapped so that, before export, URL attributes (`url.full`, `url.query`, `http.url`, `http.target`) are dropped
 * from every span of a `/v1/geo/*` route and from every CLIENT span (outbound provider URLs carry search text,
 * coordinates and sometimes keys). Spans created by the geo gateway carry only the allowlisted attributes of
 * `geoSpanAttributes` (provider key, SKU, cache status, outcome, latency) — never text, coordinates or tokens.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, api, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TelemetryConfig {
  readonly service: string;
  readonly version: string;
  readonly env: string;
  readonly otlpEndpoint: string | undefined;
}

export interface TelemetryHandle {
  readonly exporting: boolean;
  shutdown(): Promise<void>;
}

type SpanExporter = NodeSDKConfiguration['traceExporter'];
type ExportedSpan = Parameters<SpanExporter['export']>[0][number];

/** URL-bearing attributes (stable and legacy semantic conventions). */
const URL_ATTRIBUTES = ['url.full', 'url.query', 'http.url', 'http.target'] as const;
const ROUTE_ATTRIBUTES = ['http.route', 'url.path', 'http.target'] as const;
const GEO_ROUTE = /^\/v1\/geo(\/|$)/;

/**
 * Removes URL attributes in place when the span belongs to a geo route or is a CLIENT span; returns the keys removed.
 * @internal exported for unit tests.
 */
export function scrubSpanUrlAttributes(kind: api.SpanKind, attributes: Record<string, unknown>): string[] {
  const geoRoute = ROUTE_ATTRIBUTES.some((k) => {
    const v = attributes[k];
    return typeof v === 'string' && GEO_ROUTE.test(v);
  });
  if (!geoRoute && kind !== api.SpanKind.CLIENT) return [];
  const removed: string[] = [];
  for (const k of URL_ATTRIBUTES) {
    if (k in attributes) {
      Reflect.deleteProperty(attributes, k);
      removed.push(k);
    }
  }
  return removed;
}

/**
 * Exporter wrapper that scrubs URL attributes before any span leaves the process.
 * @internal exported for unit tests.
 */
export function scrubbingExporter(inner: SpanExporter): SpanExporter {
  return {
    export(spans: ExportedSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
      for (const span of spans) scrubSpanUrlAttributes(span.kind, span.attributes);
      inner.export(spans, resultCallback);
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

export function startTelemetry(config: TelemetryConfig): TelemetryHandle {
  if (!config.otlpEndpoint) return { exporting: false, shutdown: () => Promise.resolve() };
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.service,
      [ATTR_SERVICE_VERSION]: config.version,
      'deployment.environment.name': config.env,
    }),
    traceExporter: scrubbingExporter(new OTLPTraceExporter({ url: `${config.otlpEndpoint.replace(/\/$/, '')}/v1/traces` })),
  });
  sdk.start();
  return { exporting: true, shutdown: () => sdk.shutdown() };
}

/** The only attributes a geo gateway span may carry (docs/phase3/PHASE3_ARCHITECTURE.md §10). */
export interface GeoSpanFacts {
  readonly providerKey: string | null;
  readonly sku: string;
  readonly cacheStatus: 'HIT' | 'MISS' | 'STALE_SERVED' | 'NONE';
  /** Stable outcome code, e.g. OK, BUDGET_EXHAUSTED, BREAKER_OPEN, TIMEOUT, PROVIDER_ERROR. */
  readonly outcome: string;
  readonly latencyMs: number;
}

const OUTCOME = /^[A-Z][A-Z0-9_]{1,40}$/;
const PROVIDER_KEY = /^[a-z][a-z0-9-]{1,31}$/;

/** Allowlisted, shape-checked span attributes for a geo gateway call (anything else is dropped). */
export function geoSpanAttributes(facts: GeoSpanFacts): Record<string, string | number> {
  return {
    'geo.sku': OUTCOME.test(facts.sku) ? facts.sku : 'INVALID',
    'geo.provider_key': facts.providerKey !== null && PROVIDER_KEY.test(facts.providerKey) ? facts.providerKey : 'none',
    'geo.cache_status': facts.cacheStatus,
    'geo.outcome': OUTCOME.test(facts.outcome) ? facts.outcome : 'INVALID',
    'geo.latency_ms': Number.isFinite(facts.latencyMs) ? Math.max(0, Math.round(facts.latencyMs)) : -1,
  };
}

/** Records one geo gateway call as a finished span `geo.gateway.<sku>` (a no-op tracer when telemetry is off). */
export function recordGeoSpan(startedAt: number, facts: GeoSpanFacts): void {
  const span = api.trace.getTracer('wayvro.geo').startSpan(`geo.gateway.${facts.sku.toLowerCase()}`, { startTime: startedAt });
  span.setAttributes(geoSpanAttributes(facts));
  if (facts.outcome !== 'OK') span.setStatus({ code: api.SpanStatusCode.ERROR });
  span.end();
}

/** The only attributes a pricing span (`pricing.quote.create`, `pricing.engine.price`) may carry (PHASE3_ARCHITECTURE §10). */
export interface PricingSpanFacts {
  readonly name: 'pricing.quote.create' | 'pricing.engine.price';
  /** Stable outcome code, e.g. OK, ROUTING_UNAVAILABLE, SERVICE_AREA, RATE_LIMITED. */
  readonly outcome: string;
  readonly productCount: number;
  readonly latencyMs: number;
}

/** Allowlisted, shape-checked span attributes for a pricing span — never coordinates, amounts, a polyline or an account. */
export function pricingSpanAttributes(facts: PricingSpanFacts): Record<string, string | number> {
  return {
    'pricing.outcome': OUTCOME.test(facts.outcome) ? facts.outcome : 'INVALID',
    'pricing.product_count': Number.isInteger(facts.productCount) && facts.productCount >= 0 ? facts.productCount : -1,
    'pricing.latency_ms': Number.isFinite(facts.latencyMs) ? Math.max(0, Math.round(facts.latencyMs)) : -1,
  };
}

/** Records one pricing step as a finished span (a no-op tracer when telemetry is off). */
export function recordPricingSpan(startedAt: number, facts: PricingSpanFacts): void {
  const span = api.trace.getTracer('wayvro.pricing').startSpan(facts.name, { startTime: startedAt });
  span.setAttributes(pricingSpanAttributes(facts));
  if (facts.outcome !== 'OK') span.setStatus({ code: api.SpanStatusCode.ERROR });
  span.end();
}
