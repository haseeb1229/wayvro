// LOCAL RUNNER ONLY (ADR-045): runtime control of the synthetic geo doubles for the local load harness and the
// FAULT-GEO soak (tools/load-harness; docs/phase3/PHASE3_TEST_STRATEGY.md §4.7, §4.20, §5 full tier). Mounted only when
// the runner is started with WAYVRO_LOCAL_GEO_CONTROL=1; it sets/clears the doubles' fault modes and reports their call
// counters (numbers only — never inputs, text or coordinates). The route exists only in this non-deployable runner, and
// the CI artifact-isolation check proves `/__local/` routes and these variable names are absent from release artefacts.
import { Body, Controller, Delete, Get, HttpCode, Put, type Type } from '@nestjs/common';
import { WayvroError } from '@wayvro/observability';
import type { GeoTestDoubles } from '@wayvro/provider-test-doubles';
import { z } from 'zod';
import { Public } from '../src/auth/policy.js';

const SKUS = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE'] as const;
type Sku = (typeof SKUS)[number];

const FaultRequestSchema = z.strictObject({
  sku: z.enum([...SKUS, 'ALL']),
  mode: z.enum(['NONE', 'TIMEOUT', 'UPSTREAM_5XX', 'CONNECT_ERROR', 'MALFORMED', 'SLOW_DRIP', 'QUOTA', 'PARTIAL', 'EMPTY', 'ECHO_QUERY', 'REJECTED_INPUT']),
  times: z.number().int().min(1).max(1000).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  retryAfterSeconds: z.number().int().min(1).max(3600).optional(),
});

/**
 * `WAYVRO_LOCAL_GEO_LATENCY_MS`, e.g. `ROUTE=250,AUTOCOMPLETE=120`: synthetic per-SKU latency of the doubles (configured
 * representative values for local load runs, not measured provider latencies). Empty/absent = no latency.
 */
export function parseGeoLatency(value: string | undefined): Partial<Record<Sku, number>> {
  const out: Partial<Record<Sku, number>> = {};
  if (value === undefined || value.trim() === '') return out;
  for (const entry of value.split(',')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(\d{1,5})\s*$/.exec(entry);
    const sku = SKUS.find((s) => s === m?.[1]);
    if (!m || !sku) throw new Error(`WAYVRO_LOCAL_GEO_LATENCY_MS: invalid entry "${entry}" (expected SKU=ms with SKU in ${SKUS.join('|')})`);
    out[sku] = Number(m[2]);
  }
  return out;
}

export function localGeoControl(control: GeoTestDoubles['control']): Type {
  @Controller()
  class LocalGeoControlController {
    @Get('/__local/geo-control')
    @Public()
    calls(): { calls: Record<Sku, number> } {
      return { calls: Object.fromEntries(SKUS.map((s) => [s, control.calls(s)])) as Record<Sku, number> };
    }

    /** Replaces every active fault with this one (`mode: NONE` = clear). */
    @Put('/__local/geo-control/fault')
    @HttpCode(204)
    @Public()
    setFault(@Body() body: unknown): void {
      const f = FaultRequestSchema.safeParse(body);
      if (!f.success) throw new WayvroError('WAYVRO_E_VALIDATION');
      control.clearFaults();
      const { sku, mode, times, delayMs, retryAfterSeconds } = f.data;
      if (mode === 'NONE') return;
      control.setFault(sku, {
        mode,
        ...(times === undefined ? {} : { times }),
        ...(delayMs === undefined ? {} : { delayMs }),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      });
    }

    @Delete('/__local/geo-control/fault')
    @HttpCode(204)
    @Public()
    clearFaults(): void {
      control.clearFaults();
    }
  }
  return LocalGeoControlController;
}
