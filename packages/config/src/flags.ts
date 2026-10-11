/**
 * Feature-flag registry foundation (docs/27 §6, GR-05). Flags are controlled debt: each one records owner, purpose,
 * per-environment default, enforcement side, requirement IDs and an expiry date. Security or entitlement decisions
 * never rely on a client-side flag alone.
 *
 * Flags are added together with the feature they guard; `pnpm --filter @wayvro/config flags:check` (run in CI)
 * rejects invalid or expired entries. Evaluation is server-side from the registered per-environment defaults only
 * (no runtime override channel exists yet; a change is a reviewed code change).
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

export const FLAG_REGISTRY: readonly FlagDefinition[] = [
  {
    key: 'driver.onboarding',
    owner: 'founder',
    purpose:
      'Driver/Partner onboarding inside the one Wayvro app (applications, vehicles, documents, evidence, review). OFF in staging/production until the KYC gates (EG-02/03/04/05/10/11/12/20) clear.',
    requirementIds: ['V03', 'D01', 'D02', 'D04', 'K02'],
    enforcement: 'server',
    defaults: { local: true, test: true, staging: false, production: false },
    expiresOn: '2027-06-30',
  },
  {
    key: 'ops.kyc-real-evidence',
    owner: 'founder',
    purpose:
      'Staff may view REAL identity evidence in staging/production. OFF until production storage/KMS (EG-05), the DPIA/biometric gate (EG-10) and the independent security assessment (EG-17) clear; when ON, viewers also need two registered authenticators. Local/test hold synthetic evidence only and are not gated by this flag.',
    requirementIds: ['K11', 'H02', 'W07'],
    enforcement: 'server',
    defaults: { local: false, test: false, staging: false, production: false },
    expiresOn: '2027-06-30',
  },
  {
    key: 'platform.auth-oidc-google',
    owner: 'founder',
    purpose:
      'Google sign-in as an OPTIONAL linked convenience (never account creation; phone stays the credential). ON only in the automated test environment, where a local JWKS fixture signs the tokens; OFF in local/staging/production until a Google client and the activation tests clear (EG-06, P2.A2).',
    requirementIds: ['K15', 'S13'],
    enforcement: 'server',
    defaults: { local: false, test: true, staging: false, production: false },
    expiresOn: '2027-06-30',
  },
  {
    key: 'platform.auth-oidc-apple',
    owner: 'founder',
    purpose:
      'Sign in with Apple as an OPTIONAL linked convenience (never account creation; phone stays the credential). ON only in the automated test environment with the local JWKS fixture; OFF in local/staging/production until the Apple Developer setup and the activation tests clear (EG-07, P2.A3).',
    requirementIds: ['K16', 'S13'],
    enforcement: 'server',
    defaults: { local: false, test: true, staging: false, production: false },
    expiresOn: '2027-06-30',
  },
];

/** Server-side flag evaluation (registered default for the environment). Unknown keys are OFF. */
export function isFlagEnabled(key: string, env: WayvroEnv, registry: readonly FlagDefinition[] = FLAG_REGISTRY): boolean {
  return registry.find((f) => f.key === key)?.defaults[env] ?? false;
}

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
