/**
 * Feature-flag registry foundation (docs/27 §6, GR-05). Flags are controlled debt: each one records owner, purpose,
 * per-environment default, enforcement side, requirement IDs and an expiry date. Security or entitlement decisions
 * never rely on a client-side flag alone.
 *
 * Phase 1 registers no flags — no product capability exists yet. The first flag is added together with the feature
 * it guards; `pnpm --filter @wayvro/config flags:check` (run in CI) rejects invalid or expired entries.
 */
import type { WayvroEnv } from './env.js';

export interface FlagDefinition {
  /** kebab-case, prefixed by surface: `rider.`, `driver.`, `ops.`, `platform.` */
  readonly key: string;
  readonly owner: string;
  readonly purpose: string;
  readonly requirementIds: readonly string[];
  readonly enforcement: 'server' | 'client-presentation-only';
  readonly defaults: Readonly<Record<WayvroEnv, boolean>>;
  /** ISO date (YYYY-MM-DD) after which CI fails until the flag is removed or its expiry is re-justified. */
  readonly expiresOn: string;
  /** Required when the production default is `true` (who approved exposing it). */
  readonly productionApprovedBy?: string;
}

export const FLAG_REGISTRY: readonly FlagDefinition[] = [];

const KEY_PATTERN = /^(rider|driver|ops|platform)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIREMENT_ID = /^[A-Z]\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns human-readable problems; an empty array means the registry is valid on `today` (YYYY-MM-DD, server time). */
export function validateFlagRegistry(flags: readonly FlagDefinition[], today: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of flags) {
    const where = `flag "${f.key}"`;
    if (!KEY_PATTERN.test(f.key)) problems.push(`${where}: key must match ${KEY_PATTERN.source}`);
    if (seen.has(f.key)) problems.push(`${where}: duplicate key`);
    seen.add(f.key);
    if (f.owner.trim() === '') problems.push(`${where}: owner is required`);
    if (f.purpose.trim() === '') problems.push(`${where}: purpose is required`);
    if (f.requirementIds.length === 0 || !f.requirementIds.every((id) => REQUIREMENT_ID.test(id))) {
      problems.push(`${where}: at least one valid requirement ID (e.g. "B16") is required`);
    }
    if (!ISO_DATE.test(f.expiresOn) || Number.isNaN(Date.parse(f.expiresOn))) problems.push(`${where}: expiresOn must be YYYY-MM-DD`);
    else if (f.expiresOn < today) problems.push(`${where}: expired on ${f.expiresOn}; remove the flag or re-justify its expiry`);
    if (f.defaults.production && !f.productionApprovedBy) problems.push(`${where}: production default ON requires productionApprovedBy`);
  }
  return problems;
}
