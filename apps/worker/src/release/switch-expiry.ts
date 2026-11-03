/**
 * Runtime-switch `effective_until` expiry (ADR-049): a target moved to its safe state with an end time returns to the
 * registry default for the environment when that time passes (server time). The end was set by the staff member who
 * applied the safe state, so the return is pre-authorised: it is recorded as an EXPIRY change (no staff actor), audited
 * as SYSTEM, written to the outbox (`platform.runtime-switch.changed.v1`) and raised as RUNTIME_SWITCH_CHANGED. Same
 * advisory lock per target as the staff path; a row already at its default only has its end time cleared.
 */
import { runtimeSwitchDefinition, runtimeSwitchTargetLockKey, type SwitchScope, type SwitchState, type WayvroEnv } from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { appendAudit, uuidv7, withTransaction } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ActivationOutcome, ScheduledActivator } from './activation.js';

const OBJECT = 'platform.runtime_switch';
const BATCH = 100;

interface ExpiringRow {
  id: string;
  key: string;
  scope: SwitchScope;
  city_code: string | null;
  state: SwitchState;
}

export function runtimeSwitchExpiryActivator(deps: { readonly pool: pg.Pool; readonly env: WayvroEnv; readonly log: Logger }): ScheduledActivator {
  const expireOne = (target: ExpiringRow): Promise<boolean> =>
    withTransaction(deps.pool, async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [runtimeSwitchTargetLockKey(target.key, target.scope, target.city_code)]);
      const row = (
        await tx.query<ExpiringRow>(
          `select id, key, scope, city_code, state from platform.runtime_switches where id = $1 and effective_until <= now() for update`,
          [target.id],
        )
      ).rows[0];
      if (!row) return false;
      const definition = runtimeSwitchDefinition(row.key);
      // A row whose key left the registry has no default to return to: its state is left as is (the reader never
      // evaluates unknown keys), only the end time is cleared so it is reported once instead of every minute.
      if (!definition) {
        await tx.query(`update platform.runtime_switches set effective_until = null, updated_at = now(), version = version + 1 where id = $1`, [row.id]);
        deps.log.error({ signal: 'RUNTIME_SWITCH_UNKNOWN_KEY', key: row.key }, 'expiring runtime switch has no registry definition');
        return false;
      }
      const defaultState = definition.defaults[deps.env];
      if (row.state === defaultState) {
        await tx.query(`update platform.runtime_switches set effective_until = null, updated_at = now(), version = version + 1 where id = $1`, [row.id]);
        return false;
      }
      await tx.query(
        `update platform.runtime_switches set state = $2, reason_code = 'EFFECTIVE_UNTIL_REACHED', message_key = null, expected_end = null, effective_until = null,
                changed_by_staff_id = null, approved_by_staff_id = null, updated_at = now(), version = version + 1 where id = $1`,
        [row.id, defaultState],
      );
      const changeId = uuidv7();
      await tx.query(
        `insert into platform.runtime_switch_changes (id, switch_key, scope, city_code, from_state, to_state, direction, status, requested_by_staff_id, reason_code, decided_at)
         values ($1, $2, $3, $4, $5, $6, 'EXPIRY', 'APPLIED', null, 'EFFECTIVE_UNTIL_REACHED', now())`,
        [changeId, row.key, row.scope, row.city_code, row.state, defaultState],
      );
      await tx.query(
        `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status) values ($1, 'platform.runtime-switch.changed.v1', $2, $3, null, $4, 'PENDING')`,
        [
          uuidv7(),
          OBJECT,
          row.id,
          JSON.stringify({ key: row.key, scope: row.scope, cityCode: row.city_code, state: defaultState, direction: 'EXPIRY', changeId }),
        ],
      );
      await appendAudit(tx, {
        actor: { type: 'SYSTEM' },
        action: 'RUNTIME_SWITCH_EXPIRED',
        objectType: OBJECT,
        objectId: row.id,
        outcome: 'SUCCESS',
        reasonCode: 'EFFECTIVE_UNTIL_REACHED',
      });
      deps.log.warn(
        {
          signal: 'RUNTIME_SWITCH_CHANGED',
          alert: true,
          key: row.key,
          scope: row.scope,
          cityCode: row.city_code,
          toState: defaultState,
          direction: 'EXPIRY',
          actor: 'SYSTEM',
        },
        'runtime switch returned to its default at effective_until',
      );
      return true;
    });

  return {
    kind: 'runtime-switch-expiry',
    async runDue(): Promise<ActivationOutcome> {
      const due = await deps.pool.query<ExpiringRow>(
        `select id, key, scope, city_code, state from platform.runtime_switches where effective_until <= now() order by effective_until, id limit $1`,
        [BATCH],
      );
      let applied = 0;
      for (const row of due.rows) if (await expireOne(row)) applied++;
      return { applied, refused: 0 };
    },
  };
}
