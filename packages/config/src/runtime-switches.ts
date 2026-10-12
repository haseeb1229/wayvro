/**
 * Runtime kill-switch registry (Phase 3 P3.4; A01/V10/I11; docs/phase3/PHASE3_ARCHITECTURE.md §9.1; ADR-049).
 *
 * Switches are OPERATIONAL controls stored in `platform.runtime_switches` (with an append-only change history) and
 * evaluated server-side only; feature flags (`flags.ts`) stay code-only release toggles. A feature may need both: its
 * flag ON and its switch not in the safe state. Rules enforced around this registry:
 *  - keys exist only here — the database cannot invent a switch; unknown keys are refused;
 *  - a switch can only REDUCE capability (its safe state stops something); no switch may disable authentication,
 *    authorisation, rate limits, budgets, zone checks or audit (test-enforced: `securityControl` is always false);
 *  - moving TO the safe state = one authorised staff member with step-up and a reason code; moving AWAY from it =
 *    maker-checker (a different staff member approves);
 *  - absence of a row = the registry default for the environment.
 */
import type { WayvroEnv } from './env.js';

export type SwitchState = 'ENABLED' | 'DISABLED';
export type SwitchScope = 'ALL' | 'RIDER' | 'DRIVER';

export interface RuntimeSwitchDefinition {
  /** Same key pattern as flags: `rider.`, `driver.`, `ops.`, `platform.` + kebab-case. */
  readonly key: string;
  readonly owner: string;
  readonly purpose: string;
  readonly requirementIds: readonly string[];
  /** The emergency direction: the state that stops the capability (reached by one staff member with step-up). */
  readonly safeState: SwitchState;
  readonly allowedScopes: readonly SwitchScope[];
  /** Whether the state is shown to apps through `GET /v1/app/config` (presentation only; the server enforces anyway). */
  readonly clientVisible: boolean;
  /** Registry invariant: always false — no switch may disable a security control (T3-24). */
  readonly securityControl: false;
  /** State when no row exists. */
  readonly defaults: Readonly<Record<WayvroEnv, SwitchState>>;
}

const ON_EVERYWHERE: Readonly<Record<WayvroEnv, SwitchState>> = { local: 'ENABLED', test: 'ENABLED', staging: 'ENABLED', production: 'ENABLED' };

export const RUNTIME_SWITCH_REGISTRY: readonly RuntimeSwitchDefinition[] = [
  {
    key: 'platform.maintenance',
    owner: 'founder',
    purpose:
      'Planned maintenance: consumer routes answer 503 WAYVRO_E_MAINTENANCE (staff routes, health, app config, legal, sign-out and account deletion stay reachable). ENABLED = maintenance in progress; starting it is the safe direction.',
    requirementIds: ['A01', 'Q31'],
    safeState: 'ENABLED',
    allowedScopes: ['ALL'],
    clientVisible: true,
    securityControl: false,
    defaults: { local: 'DISABLED', test: 'DISABLED', staging: 'DISABLED', production: 'DISABLED' },
  },
  {
    key: 'platform.geo-autocomplete',
    owner: 'founder',
    purpose: 'Server geo SKU AUTOCOMPLETE (place suggestions). DISABLED stops all provider calls for it; riders type the full address or use a pin.',
    requirementIds: ['I11', 'E07', 'B02'],
    safeState: 'DISABLED',
    allowedScopes: ['ALL'],
    clientVisible: true,
    securityControl: false,
    defaults: ON_EVERYWHERE,
  },
  {
    key: 'platform.geo-geocode',
    owner: 'founder',
    purpose: 'Server geo SKUs GEOCODE and PLACE_RESOLVE (typed-address search, suggestion resolution). DISABLED stops all provider calls for them.',
    requirementIds: ['I11', 'E07', 'B02'],
    safeState: 'DISABLED',
    allowedScopes: ['ALL'],
    clientVisible: true,
    securityControl: false,
    defaults: ON_EVERYWHERE,
  },
  {
    key: 'platform.geo-reverse',
    owner: 'founder',
    purpose: 'Server geo SKU REVERSE_GEOCODE (address of a pinned point). DISABLED stops provider calls; the pin stays usable without an address.',
    requirementIds: ['I11', 'E07', 'B01'],
    safeState: 'DISABLED',
    allowedScopes: ['ALL'],
    clientVisible: true,
    securityControl: false,
    defaults: ON_EVERYWHERE,
  },
  {
    key: 'platform.geo-routing',
    owner: 'founder',
    purpose: 'Server geo SKU ROUTE (routing for quotes). DISABLED stops provider calls; quotes are refused (503 ROUTING_UNAVAILABLE), never estimated.',
    requirementIds: ['I11', 'E07', 'B03'],
    safeState: 'DISABLED',
    allowedScopes: ['ALL'],
    clientVisible: true,
    securityControl: false,
    defaults: ON_EVERYWHERE,
  },
  {
    key: 'rider.quotes',
    owner: 'founder',
    purpose: 'Rider price checks (POST /v1/quotes). DISABLED stops new quotes (stored quotes stay readable by their owner).',
    requirementIds: ['A01', 'B06', 'V10'],
    safeState: 'DISABLED',
    allowedScopes: ['ALL', 'RIDER'],
    clientVisible: true,
    securityControl: false,
    defaults: ON_EVERYWHERE,
  },
];

export const RUNTIME_SWITCH_KEYS: readonly string[] = RUNTIME_SWITCH_REGISTRY.map((s) => s.key);

export function runtimeSwitchDefinition(key: string): RuntimeSwitchDefinition | undefined {
  return RUNTIME_SWITCH_REGISTRY.find((s) => s.key === key);
}

/**
 * Read side used by every server module that honours a switch (geo gateway, quotes, maintenance hook). Implemented by
 * the release-controls module (cached ≤ RUNTIME_SWITCH_CACHE_SECONDS, registry default when no row exists).
 */
export interface RuntimeSwitchReader {
  /** True when the switch is in its SAFE state (the capability is stopped) for the scope/city. Unknown keys throw. */
  isStopped(key: string, context?: { readonly scope?: Exclude<SwitchScope, 'ALL'>; readonly cityCode?: string }): Promise<boolean>;
}

const KEY_PATTERN = /^(rider|driver|ops|platform)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIREMENT_ID = /^[A-Z]\d{2}$/;

/** Returns human-readable problems; an empty array means the registry is valid (run in CI with the flag check). */
export function validateRuntimeSwitchRegistry(switches: readonly RuntimeSwitchDefinition[] = RUNTIME_SWITCH_REGISTRY): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of switches) {
    const where = `switch "${s.key}"`;
    if (!KEY_PATTERN.test(s.key)) problems.push(`${where}: key must match ${KEY_PATTERN.source}`);
    if (seen.has(s.key)) problems.push(`${where}: duplicate key`);
    seen.add(s.key);
    if (s.owner.trim() === '' || s.purpose.trim() === '') problems.push(`${where}: owner and purpose are required`);
    if (s.requirementIds.length === 0 || !s.requirementIds.every((id) => REQUIREMENT_ID.test(id))) problems.push(`${where}: valid requirement IDs required`);
    if (s.allowedScopes.length === 0) problems.push(`${where}: at least one scope is required`);
    if ((s.securityControl as boolean) !== false) problems.push(`${where}: a runtime switch may never control a security mechanism`);
  }
  return problems;
}
