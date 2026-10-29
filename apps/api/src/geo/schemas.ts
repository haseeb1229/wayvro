/**
 * Validation of adapter outputs and cache entries (threat model T3-21: provider data is untrusted). Numbers must be
 * finite and in range, strings bounded, result points inside the coarse Pakistan envelope; unknown fields are dropped.
 * A response that fails is a MALFORMED provider answer (counted as a provider failure), never partially used.
 */
import { inPakistanEnvelope } from '@wayvro/domain';
import { z } from 'zod';
import { PLACE_ID_MAX_LENGTH } from './place-ref.js';

const Text = z.string().max(500).nullable();
const ComponentsSchema = z.object({ name: Text, block: Text, society: Text, area: Text, city: Text, nameUrdu: Text });
const Point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
/** A provider-returned location: finite, in range and inside the Pakistan envelope. */
const PakistanPointSchema = Point.refine(inPakistanEnvelope);
const Kind = z.enum(['LANDMARK', 'ADDRESS', 'AREA', 'OTHER']);
const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

const CandidateSchema = z.object({ providerPlaceId: z.string().min(1).max(PLACE_ID_MAX_LENGTH), components: ComponentsSchema, kind: Kind });
export const CandidateListSchema = z.array(CandidateSchema).max(50);
export const ResolvedPlaceOutSchema = z.object({ point: PakistanPointSchema, components: ComponentsSchema, kind: Kind, confidence: Confidence });
export const ResolvedPlaceListSchema = z.array(ResolvedPlaceOutSchema).max(50);
export const NullableResolvedPlaceSchema = ResolvedPlaceOutSchema.nullable();
export const RouteResultOutSchema = z.object({
  distanceM: z.number().int().positive().max(2_000_000),
  // a route without a duration is refused, never defaulted (FG-06)
  durationS: z
    .number()
    .int()
    .nonnegative()
    .max(7 * 86_400),
  geometry: z.array(PakistanPointSchema).max(100_000),
  confidence: Confidence,
});

export type ValidCandidate = z.infer<typeof CandidateSchema>;
export type ValidPlace = z.infer<typeof ResolvedPlaceOutSchema>;

/** `schema.parse` that returns null instead of throwing (the caller counts it as MALFORMED). */
export function validOrNull<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Held GEOCODE suggestion (resolved later through its placeRef without another provider call). */
export const HeldGeocodeSchema = z.object({
  point: PakistanPointSchema,
  primaryText: z.string().min(1).max(200),
  secondaryText: z.string().min(1).max(200).nullable(),
  confidence: Confidence,
  fetchedAt: z.iso.datetime({ offset: true }),
});
export type HeldGeocode = z.infer<typeof HeldGeocodeSchema>;
