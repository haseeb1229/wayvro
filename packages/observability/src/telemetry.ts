/**
 * OpenTelemetry bootstrap. Must run before the instrumented framework is imported (see each app's `main.ts`).
 * Without `OTEL_EXPORTER_OTLP_ENDPOINT` nothing is exported (local default); traces never carry PII attributes.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
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

export function startTelemetry(config: TelemetryConfig): TelemetryHandle {
  if (!config.otlpEndpoint) return { exporting: false, shutdown: () => Promise.resolve() };
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.service,
      [ATTR_SERVICE_VERSION]: config.version,
      'deployment.environment.name': config.env,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${config.otlpEndpoint.replace(/\/$/, '')}/v1/traces` }),
  });
  sdk.start();
  return { exporting: true, shutdown: () => sdk.shutdown() };
}
