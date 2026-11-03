/**
 * Staff administration of runtime switches (A01/V10/I11; ADR-049; T3-24). Keys exist only in the code registry
 * (unknown keys and disallowed scopes are refused). Moving a target TO its safe state is one authorised staff member
 * with step-up and a reason code (route policy `platform.switch.disable`), applied at once, with an optional
 * `effective_until` after which the worker returns it to the registry default. Moving AWAY from the safe state is
 * maker-checker: a request (`platform.switch.enable_request`) and an approval by a DIFFERENT staff member
 * (`platform.switch.enable_approve`; database CHECK too). Every change is audited, appended to the change history,
 * written to the outbox (`platform.runtime-switch.changed.v1`) and raises the alert-level RUNTIME_SWITCH_CHANGED signal.
 * Changes are serialised per target with a transaction-scoped advisory lock (the worker expiry takes the same lock).
 */
import {
  RUNTIME_SWITCH_REGISTRY,
  runningSwitchState,
  runtimeSwitchDefinition,
  runtimeSwitchTargetLockKey,
  type RuntimeSwitchDefinition,
  type SwitchScope,
  type SwitchState,
  type WayvroEnv,
} from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { appendAudit, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome, type Refusal } from '../idempotency.js';
import { emitEvent } from '../outbox.js';
import type { StaffPrincipal } from '../../staff/staff-session.js';
import { baseState } from './switches.js';

export interface SwitchAdminPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
}

export interface SwitchTarget {
  readonly key: string;
  readonly scope: SwitchScope;
  readonly cityCode?: string | undefined;
}
export interface SafeStateInput extends SwitchTarget {
  readonly reasonCode: string;
  readonly messageKey?: string | undefined;
  readonly expectedEnd?: string | undefined;
  readonly effectiveUntil?: string | undefined;
}
export interface RestoreInput extends SwitchTarget {
  readonly reasonCode: string;
}

interface SwitchRow {
  id: string;
  key: string;
  scope: SwitchScope;
  city_code: string | null;
  state: SwitchState;
  reason_code: string;
  message_key: string | null;
  expected_end: Date | null;
  effective_until: Date | null;
  changed_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  updated_at: Date;
}
interface ChangeRow {
  id: string;
  switch_key: string;
  scope: SwitchScope;
  city_code: string | null;
  from_state: SwitchState;
  to_state: SwitchState;
  direction: string;
  status: string;
  requested_by_staff_id: string | null;
  approved_by_staff_id: string | null;
  reason_code: string;
  message_key: string | null;
  expected_end: Date | null;
  effective_until: Date | null;
  created_at: Date;
  decided_at: Date | null;
}

const OBJECT = 'platform.runtime_switch';
const iso = (d: Date | null) => d?.toISOString() ?? null;
const changeView = (c: ChangeRow) => ({
  id: c.id,
  key: c.switch_key,
  scope: c.scope,
  cityCode: c.city_code,
  fromState: c.from_state,
  toState: c.to_state,
  direction: c.direction,
  status: c.status,
  requestedByStaffId: c.requested_by_staff_id,
  approvedByStaffId: c.approved_by_staff_id,
  reasonCode: c.reason_code,
  messageKey: c.message_key,
  expectedEnd: iso(c.expected_end),
  effectiveUntil: iso(c.effective_until),
  createdAt: c.created_at.toISOString(),
  decidedAt: iso(c.decided_at),
});
const rowView = (r: SwitchRow) => ({
  scope: r.scope,
  cityCode: r.city_code,
  state: r.state,
  reasonCode: r.reason_code,
  messageKey: r.message_key,
  expectedEnd: iso(r.expected_end),
  effectiveUntil: iso(r.effective_until),
  changedByStaffId: r.changed_by_staff_id,
  approvedByStaffId: r.approved_by_staff_id,
  updatedAt: r.updated_at.toISOString(),
});

export class RuntimeSwitchAdminService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: SwitchAdminPolicy,
    private readonly log: Logger,
    /** Called after a committed state change (local cache invalidation). */
    private readonly onChange: () => void,
  ) {}

  private run(
    staff: StaffPrincipal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<Outcome>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute({ scope: `staff:${staff.staffId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS }, work);
  }

  /** The registry definition of a valid target, or the refusal (unknown key, scope not allowed, unknown city). */
  private async definitionFor(q: Queryable, target: SwitchTarget): Promise<RuntimeSwitchDefinition | Refusal> {
    const definition = runtimeSwitchDefinition(target.key);
    if (!definition) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['UNKNOWN_SWITCH'] });
    if (!definition.allowedScopes.includes(target.scope)) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['SCOPE_NOT_ALLOWED'] });
    if (target.cityCode !== undefined && (await q.query(`select 1 from catalog.cities where code = $1`, [target.cityCode])).rowCount !== 1) {
      return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['UNKNOWN_CITY'] });
    }
    return definition;
  }

  /** Locks the target and returns its row (if stored) and its current state. */
  private async lockTarget(
    tx: pg.PoolClient,
    definition: RuntimeSwitchDefinition,
    target: SwitchTarget,
  ): Promise<{ row: SwitchRow | undefined; state: SwitchState }> {
    const city = target.cityCode ?? null;
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [runtimeSwitchTargetLockKey(target.key, target.scope, city)]);
    const row = (
      await tx.query<SwitchRow>(`select * from platform.runtime_switches where key = $1 and scope = $2 and city_code is not distinct from $3 for update`, [
        target.key,
        target.scope,
        city,
      ])
    ).rows[0];
    const isBase = target.scope === 'ALL' && city === null;
    // an absent base row = the registry default; an absent narrower row stops nothing (= running state)
    const state = row?.state ?? (isBase ? definition.defaults[this.policy.WAYVRO_ENV] : runningSwitchState(definition));
    return { row, state };
  }

  private changed(staffOrSystem: string, c: ChangeRow): void {
    this.log.warn(
      {
        signal: 'RUNTIME_SWITCH_CHANGED',
        alert: true,
        key: c.switch_key,
        scope: c.scope,
        cityCode: c.city_code,
        toState: c.to_state,
        direction: c.direction,
        actor: staffOrSystem,
      },
      'runtime switch changed',
    );
  }

  private async emit(tx: Queryable, switchId: string, c: ChangeRow): Promise<void> {
    await emitEvent(tx, {
      type: 'platform.runtime-switch.changed.v1',
      aggregateType: OBJECT,
      aggregateId: switchId,
      accountId: null,
      payload: { key: c.switch_key, scope: c.scope, cityCode: c.city_code, state: c.to_state, direction: c.direction, changeId: c.id },
    });
  }

  async list(): Promise<unknown> {
    const [rows, pending] = await Promise.all([
      this.db.query<SwitchRow>(`select * from platform.runtime_switches order by key, scope, city_code nulls first`),
      this.db.query<ChangeRow>(`select * from platform.runtime_switch_changes where status = 'PENDING_APPROVAL' order by created_at`),
    ]);
    const targets = rows.rows.map((r) => ({ key: r.key, scope: r.scope, cityCode: r.city_code, state: r.state }));
    return {
      switches: RUNTIME_SWITCH_REGISTRY.map((d) => ({
        key: d.key,
        purpose: d.purpose,
        safeState: d.safeState,
        allowedScopes: d.allowedScopes,
        clientVisible: d.clientVisible,
        defaultState: d.defaults[this.policy.WAYVRO_ENV],
        baseState: baseState(d, targets, this.policy.WAYVRO_ENV),
        rows: rows.rows.filter((r) => r.key === d.key).map(rowView),
      })),
      pendingRequests: pending.rows.map(changeView),
    };
  }

  async changes(cursor?: string): Promise<unknown> {
    const r = await this.db.query<ChangeRow>(`select * from platform.runtime_switch_changes where ($1::uuid is null or id < $1) order by id desc limit 51`, [
      cursor ?? null,
    ]);
    return { changes: r.rows.slice(0, 50).map(changeView), nextCursor: r.rows.length > 50 ? (r.rows[49]?.id ?? null) : null };
  }

  moveToSafe(staff: StaffPrincipal, input: SafeStateInput, key: string): Promise<IdempotentResult> {
    let applied: ChangeRow | undefined;
    return this.run(staff, 'switches.safe-state', key, input, async (tx) => {
      const definition = await this.definitionFor(tx, input);
      if ('kind' in definition) return definition;
      const times = (
        await tx.query<{ until_ok: boolean; end_ok: boolean }>(
          `select ($1::timestamptz is null or $1 > now()) until_ok, ($2::timestamptz is null or $2 > now()) end_ok`,
          [input.effectiveUntil ?? null, input.expectedEnd ?? null],
        )
      ).rows[0];
      if (!times?.until_ok || !times.end_ok) return failure('WAYVRO_E_VALIDATION', { reasonCodes: ['TIME_IN_PAST'] });
      const { row, state } = await this.lockTarget(tx, definition, input);
      if (state === definition.safeState) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['ALREADY_IN_SAFE_STATE'] });
      const values = [definition.safeState, input.reasonCode, input.messageKey ?? null, input.expectedEnd ?? null, input.effectiveUntil ?? null, staff.staffId];
      const switchId = row?.id ?? uuidv7();
      if (row) {
        await tx.query(
          `update platform.runtime_switches set state = $2, reason_code = $3, message_key = $4, expected_end = $5, effective_until = $6, changed_by_staff_id = $7,
                  approved_by_staff_id = null, updated_at = now(), version = version + 1 where id = $1`,
          [switchId, ...values],
        );
      } else {
        await tx.query(
          `insert into platform.runtime_switches (id, key, scope, city_code, state, reason_code, message_key, expected_end, effective_until, changed_by_staff_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [switchId, input.key, input.scope, input.cityCode ?? null, ...values],
        );
      }
      const change = (
        await tx.query<ChangeRow>(
          `insert into platform.runtime_switch_changes (id, switch_key, scope, city_code, from_state, to_state, direction, status, requested_by_staff_id, reason_code, message_key,
                                                        expected_end, effective_until, decided_at)
           values ($1, $2, $3, $4, $5, $6, 'TO_SAFE', 'APPLIED', $7, $8, $9, $10, $11, now()) returning *`,
          [
            uuidv7(),
            input.key,
            input.scope,
            input.cityCode ?? null,
            state,
            definition.safeState,
            staff.staffId,
            input.reasonCode,
            input.messageKey ?? null,
            input.expectedEnd ?? null,
            input.effectiveUntil ?? null,
          ],
        )
      ).rows[0] as ChangeRow;
      await this.emit(tx, switchId, change);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'RUNTIME_SWITCH_SAFE_STATE_APPLIED',
        objectType: OBJECT,
        objectId: switchId,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      applied = change;
      return success(201, changeView(change));
    }).then((r) => this.afterChange(r, staff, applied));
  }

  requestRestore(staff: StaffPrincipal, input: RestoreInput, key: string): Promise<IdempotentResult> {
    return this.run(staff, 'switches.restore-request', key, input, async (tx) => {
      const definition = await this.definitionFor(tx, input);
      if ('kind' in definition) return definition;
      const { row, state } = await this.lockTarget(tx, definition, input);
      if (!row || state !== definition.safeState) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NOT_IN_SAFE_STATE'] });
      await tx.query('savepoint restore_request');
      let change: ChangeRow;
      try {
        change = (
          await tx.query<ChangeRow>(
            `insert into platform.runtime_switch_changes (id, switch_key, scope, city_code, from_state, to_state, direction, status, requested_by_staff_id, reason_code)
             values ($1, $2, $3, $4, $5, $6, 'FROM_SAFE', 'PENDING_APPROVAL', $7, $8) returning *`,
            [uuidv7(), input.key, input.scope, input.cityCode ?? null, state, runningSwitchState(definition), staff.staffId, input.reasonCode],
          )
        ).rows[0] as ChangeRow;
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint restore_request');
        return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['RESTORE_ALREADY_PENDING'] });
      }
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'RUNTIME_SWITCH_RESTORE_REQUESTED',
        objectType: OBJECT,
        objectId: row.id,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      return success(201, changeView(change));
    });
  }

  decideRestore(staff: StaffPrincipal, id: string, decision: 'APPROVE' | 'REJECT', key: string): Promise<IdempotentResult> {
    let applied: ChangeRow | undefined;
    return this.run(staff, 'switches.restore-decision', key, { id, decision }, async (tx) => {
      const target = (await tx.query<ChangeRow>(`select * from platform.runtime_switch_changes where id = $1`, [id])).rows[0];
      if (!target) return failure('WAYVRO_E_NOT_FOUND');
      const definition = runtimeSwitchDefinition(target.switch_key);
      if (!definition) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['UNKNOWN_SWITCH'] });
      // lock order: target advisory lock, then rows (same as moveToSafe/requestRestore and the worker expiry)
      const { row, state } = await this.lockTarget(tx, definition, { key: target.switch_key, scope: target.scope, cityCode: target.city_code ?? undefined });
      const change = (await tx.query<ChangeRow>(`select * from platform.runtime_switch_changes where id = $1 for update`, [id])).rows[0] as ChangeRow;
      if (change.status !== 'PENDING_APPROVAL') return failure('WAYVRO_E_CONFLICT');
      if (change.requested_by_staff_id === staff.staffId) {
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'STAFF_ACCESS_DENIED',
          objectType: OBJECT,
          objectId: row?.id,
          outcome: 'DENIED',
          reasonCode: 'MAKER_IS_CHECKER',
        });
        return failure('WAYVRO_E_FORBIDDEN');
      }
      if (decision === 'REJECT') {
        const rejected = (
          await tx.query<ChangeRow>(`update platform.runtime_switch_changes set status = 'REJECTED', decided_at = now() where id = $1 returning *`, [id])
        ).rows[0] as ChangeRow;
        await appendAudit(tx, {
          actor: { type: 'STAFF', id: staff.staffId },
          action: 'RUNTIME_SWITCH_RESTORE_REJECTED',
          objectType: OBJECT,
          objectId: row?.id,
          outcome: 'SUCCESS',
          reasonCode: change.reason_code,
        });
        return success(200, changeView(rejected));
      }
      if (!row || state !== change.from_state) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['STALE_REQUEST'] });
      await tx.query(
        `update platform.runtime_switches set state = $2, reason_code = $3, message_key = null, expected_end = null, effective_until = null, changed_by_staff_id = $4,
                approved_by_staff_id = $5, updated_at = now(), version = version + 1 where id = $1`,
        [row.id, change.to_state, change.reason_code, change.requested_by_staff_id, staff.staffId],
      );
      const done = (
        await tx.query<ChangeRow>(
          `update platform.runtime_switch_changes set status = 'APPLIED', approved_by_staff_id = $2, decided_at = now() where id = $1 returning *`,
          [id, staff.staffId],
        )
      ).rows[0] as ChangeRow;
      await this.emit(tx, row.id, done);
      await appendAudit(tx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'RUNTIME_SWITCH_RESTORED',
        objectType: OBJECT,
        objectId: row.id,
        outcome: 'SUCCESS',
        reasonCode: change.reason_code,
      });
      applied = done;
      return success(200, changeView(done));
    }).then((r) => this.afterChange(r, staff, applied));
  }

  private afterChange(result: IdempotentResult, staff: StaffPrincipal, applied: ChangeRow | undefined): IdempotentResult {
    if (applied && !result.replayed) {
      this.onChange();
      this.changed(`STAFF:${staff.staffId}`, applied);
    }
    return result;
  }
}
