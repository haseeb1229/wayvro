/**
 * Phase 3 release-control contracts (P3.4; A01/Q31/V10; docs/phase3/PHASE3_ARCHITECTURE.md §9; ADR-049). The public,
 * cacheable `GET /v1/app/config` tells an installed app whether it may continue (OK / SOFT_UPDATE / HARD_UPDATE /
 * MAINTENANCE), which presentation-relevant runtime switches are in their safe state, the map-renderer descriptor of
 * the licence-coherent geo bundle (`rendererKind: none` until the P3.7 freeze) and client tuning values. It carries no
 * per-user data and no secret. The version headers it reads are compatibility hints only (ADR-049): the server stays
 * authoritative for every business rule and enforces 426/503 itself.
 *
 * Staff release-control contracts (version policies, runtime switches, maintenance) are added to this module by P3.4.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.js';
import type { RouteContract } from './health.js';

const E = ErrorEnvelopeSchema;
const IsoDateTime = z.iso.datetime({ offset: true });
const MessageKey = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{2,80}$/);

export const CLIENT_POLICY_STATES = ['OK', 'SOFT_UPDATE', 'HARD_UPDATE', 'MAINTENANCE'] as const;
export const MAP_RENDERER_KINDS = ['none', 'google', 'mapbox', 'maplibre'] as const;
/** Runtime switch key pattern (code registry; the database cannot invent keys). */
export const RuntimeSwitchKeySchema = z.string().regex(/^(rider|driver|ops|platform)\.[a-z0-9]+(-[a-z0-9]+)*$/);

export const AppConfigSchema = z
  .object({
    serverTime: IsoDateTime,
    client: z.object({
      state: z.enum(CLIENT_POLICY_STATES),
      /** Why a HARD_UPDATE is required (from the matched blocked range or the minimum build); null otherwise. */
      reasonClass: z.enum(['SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK', 'MINIMUM_BUILD']).nullable(),
      messageKey: MessageKey.nullable(),
      /** Store link key (store ids are undecided, EG-15); null = "update from the store where you installed Wayvro". */
      storeUrlKey: z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{2,40}$/)
        .nullable(),
      recommendedBuild: z.number().int().nonnegative().nullable(),
      minSupportedBuild: z.number().int().nonnegative().nullable(),
    }),
    maintenance: z.object({ active: z.boolean(), messageKey: MessageKey.nullable(), expectedEnd: IsoDateTime.nullable() }),
    /** Presentation-relevant switches only (never a security decision; the server enforces every switch itself). */
    switches: z.array(z.object({ key: RuntimeSwitchKeySchema, state: z.enum(['ENABLED', 'DISABLED']), messageKey: MessageKey.nullable() })),
    map: z.object({
      rendererKind: z.enum(MAP_RENDERER_KINDS),
      styleUrl: z.url().nullable(),
      attributionCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/)),
      /** Restricted, rotatable client token only if the chosen renderer needs one (P3.7); never a server key. */
      clientToken: z.string().min(1).max(512).nullable(),
    }),
    geo: z.object({
      autocompleteMinChars: z.number().int().min(1).max(10),
      autocompleteDebounceMs: z.number().int().min(0).max(5000),
      reverseDebounceMs: z.number().int().min(0).max(5000),
    }),
    lite: z.object({ autoSuggestAfterSlowRequests: z.number().int().min(1).max(20), slowRequestMs: z.number().int().min(500).max(30000) }),
  })
  .meta({ id: 'AppConfig' });
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const APP_CONFIG_ROUTES = [
  {
    operationId: 'getAppConfig',
    method: 'GET',
    path: '/v1/app/config',
    summary:
      'Public, cacheable app configuration: version/update state for the calling build (from the x-wayvro-* headers), maintenance, presentation switches, map descriptor, client tuning.',
    auth: 'public',
    responses: { 200: AppConfigSchema, 400: E, 429: E, 503: E },
  },
] as const satisfies readonly RouteContract[];
