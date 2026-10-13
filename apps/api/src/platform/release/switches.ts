/**
 * Runtime switch read side (A01/V10/I11; ADR-049): the `RuntimeSwitchReader` every server module consults (geo
 * gateway, quotes, the maintenance hook). Evaluation is server-side only; the mode scope is a server concept keyed on
 * the route's capability, never on a client header.
 *
 * Semantics (switches can only REDUCE capability, T3-24):
 *  - the BASE target is (key, ALL, no city): its row, or the registry default for this environment when no row exists;
 *  - narrower rows (RIDER/DRIVER scope and/or a city) can only stop more: a capability is stopped when the base is in
 *    the safe state OR any row applicable to the caller's scope/city is in the safe state;
 *  - unknown keys throw (a programming error — the registry is the only source of keys).
 */
import {
  RUNTIME_SWITCH_REGISTRY,
  runtimeSwitchDefinition,
  type RuntimeSwitchDefinition,
  type RuntimeSwitchReader,
  type SwitchScope,
  type SwitchState,
  type WayvroEnv,
} from '@wayvro/config';
import type { MaintenanceView } from './policy.js';
import type { ReleaseStateCache, SwitchRowState } from './state.js';

const MAINTENANCE_SWITCH = 'platform.maintenance';
const CLIENT_VISIBLE_KEYS: readonly string[] = RUNTIME_SWITCH_REGISTRY.filter((s) => s.clientVisible).map((s) => s.key);

export interface SwitchContext {
  readonly scope?: Exclude<SwitchScope, 'ALL'>;
  readonly cityCode?: string;
}

function definitionOf(key: string): RuntimeSwitchDefinition {
  const definition = runtimeSwitchDefinition(key);
  if (!definition) throw new Error(`unknown runtime switch "${key}" (not in RUNTIME_SWITCH_REGISTRY)`);
  return definition;
}

type SwitchTargetState = Pick<SwitchRowState, 'key' | 'scope' | 'cityCode' | 'state'>;

/** The base (ALL scope, no city) row of a switch, if stored. */
function baseRow<R extends SwitchTargetState>(key: string, rows: readonly R[]): R | undefined {
  return rows.find((r) => r.key === key && r.scope === 'ALL' && r.cityCode === null);
}

/** State of the base target: its row, or the registry default for the environment. */
export function baseState(definition: RuntimeSwitchDefinition, rows: readonly SwitchTargetState[], env: WayvroEnv): SwitchState {
  return baseRow(definition.key, rows)?.state ?? definition.defaults[env];
}

/** Pure evaluation (see the module comment). @internal exported for tests */
export function switchStopped(definition: RuntimeSwitchDefinition, rows: readonly SwitchRowState[], env: WayvroEnv, context: SwitchContext = {}): boolean {
  if (baseState(definition, rows, env) === definition.safeState) return true;
  return rows.some(
    (r) =>
      r.key === definition.key &&
      r.state === definition.safeState &&
      (r.scope === 'ALL' || r.scope === context.scope) &&
      (r.cityCode === null || r.cityCode === context.cityCode),
  );
}

export class RuntimeSwitchStore implements RuntimeSwitchReader {
  constructor(
    private readonly state: ReleaseStateCache,
    private readonly env: WayvroEnv,
  ) {}

  async isStopped(key: string, context: SwitchContext = {}): Promise<boolean> {
    const definition = definitionOf(key);
    return switchStopped(definition, (await this.state.get()).switches, this.env, context);
  }

  /** Maintenance = `platform.maintenance` in its safe state (ENABLED); message key and expected end from its base row. */
  maintenanceOf(rows: readonly SwitchRowState[]): MaintenanceView {
    const definition = definitionOf(MAINTENANCE_SWITCH);
    if (!switchStopped(definition, rows, this.env)) return { active: false, messageKey: null, expectedEnd: null };
    const row = baseRow(MAINTENANCE_SWITCH, rows);
    return { active: true, messageKey: row?.messageKey ?? null, expectedEnd: row?.expectedEnd ?? null };
  }

  /** Presentation-relevant switch states for `GET /v1/app/config` (base targets of client-visible switches). */
  clientSwitchesOf(rows: readonly SwitchRowState[]): Array<{ key: string; state: SwitchState; messageKey: string | null }> {
    const out: Array<{ key: string; state: SwitchState; messageKey: string | null }> = [];
    for (const key of CLIENT_VISIBLE_KEYS) {
      const definition = definitionOf(key);
      out.push({ key, state: baseState(definition, rows, this.env), messageKey: baseRow(key, rows)?.messageKey ?? null });
    }
    return out;
  }
}
