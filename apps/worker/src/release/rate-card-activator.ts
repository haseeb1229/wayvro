/**
 * Scheduled activation of APPROVED rate cards whose `effective_from` (server time) has passed (P3.3; H06; pricing doc
 * §9; threat model T3-23/T3-31). Same protocol as the staff activation in the API: advisory lock per (city, product)
 * (`rateCardActivationLockKey`), compare-and-set on `status = 'APPROVED' AND scheduled`, then — at run time — every
 * activation rule again: the card's tax policy is still APPROVED; production refuses synthetic cards and placeholder tax
 * policies; never older than the ACTIVE card. A refused card is unscheduled (it stays APPROVED for staff to fix),
 * audited as SYSTEM and raised as an error signal, so it is not retried every minute. A successful activation retires
 * the previous ACTIVE card, is audited as SYSTEM and writes `pricing.rate-card.activated.v1` to the outbox. A card a
 * staff member activated first is simply no longer due (the loser of the race does nothing).
 */
import { isNonProductionLike, rateCardActivationLockKey, type WayvroEnv } from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import { appendAudit, uuidv7, withTransaction } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { ActivationOutcome, ScheduledActivator } from './activation.js';

const OBJECT = 'pricing.rate_card';
const BATCH = 50;

interface DueCard {
  id: string;
  city_code: string;
  product_code: string;
}

export function rateCardActivator(deps: { readonly pool: pg.Pool; readonly env: WayvroEnv; readonly log: Logger }): ScheduledActivator {
  const production = !isNonProductionLike(deps.env);

  const activateOne = (due: DueCard): Promise<'APPLIED' | 'REFUSED' | 'SKIPPED'> =>
    withTransaction(deps.pool, async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [rateCardActivationLockKey(due.city_code, due.product_code)]);
      const row = (
        await tx.query<{ id: string; version: number; is_synthetic: boolean }>(
          `select id, version, is_synthetic from pricing.rate_cards where id = $1 and status = 'APPROVED' and scheduled and effective_from <= now() for update`,
          [due.id],
        )
      ).rows[0];
      if (!row) return 'SKIPPED';
      const tax = (
        await tx.query<{ status: string; is_placeholder: boolean }>(
          `select t.status, t.is_placeholder from pricing.rate_card_components c join pricing.tax_policies t on t.id = c.tax_policy_id where c.rate_card_id = $1`,
          [row.id],
        )
      ).rows[0];
      const problems: string[] = [];
      if (tax?.status !== 'APPROVED') problems.push('TAX_POLICY_NOT_APPROVED');
      if (production && row.is_synthetic) problems.push('SYNTHETIC_REFUSED_IN_PRODUCTION');
      if (production && tax?.is_placeholder !== false) problems.push('PLACEHOLDER_TAX_REFUSED_IN_PRODUCTION');
      const newer = await tx.query(`select 1 from pricing.rate_cards where city_code = $1 and product_code = $2 and status = 'ACTIVE' and version > $3`, [
        due.city_code,
        due.product_code,
        row.version,
      ]);
      if (newer.rowCount !== 0) problems.push('NEWER_CARD_ACTIVE');
      if (problems.length > 0) {
        await tx.query(`update pricing.rate_cards set scheduled = false, effective_from = null, version_lock = version_lock + 1 where id = $1`, [row.id]);
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'RATE_CARD_SCHEDULE_REFUSED',
          objectType: OBJECT,
          objectId: row.id,
          outcome: 'FAILURE',
          reasonCode: problems[0],
        });
        deps.log.error(
          { signal: 'RATE_CARD_SCHEDULED_ACTIVATION_REFUSED', alert: true, rateCardId: row.id, problems },
          'scheduled rate card activation refused',
        );
        return 'REFUSED';
      }
      const previous = await tx.query<{ id: string }>(
        `update pricing.rate_cards set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1
          where city_code = $1 and product_code = $2 and status = 'ACTIVE' returning id`,
        [due.city_code, due.product_code],
      );
      for (const p of previous.rows) {
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'RATE_CARD_RETIRED',
          objectType: OBJECT,
          objectId: p.id,
          outcome: 'SUCCESS',
          reasonCode: 'SUPERSEDED_BY_ACTIVATION',
        });
      }
      await tx.query(
        `update pricing.rate_cards set status = 'ACTIVE', effective_from = now(), scheduled = false, version_lock = version_lock + 1 where id = $1 and status = 'APPROVED'`,
        [row.id],
      );
      await tx.query(
        `insert into platform.outbox_events (id, type, aggregate_type, aggregate_id, account_id, payload, status) values ($1, 'pricing.rate-card.activated.v1', $2, $3, null, $4, 'PENDING')`,
        [
          uuidv7(),
          OBJECT,
          row.id,
          JSON.stringify({
            cityCode: due.city_code,
            productCode: due.product_code,
            version: row.version,
            previousRateCardId: previous.rows[0]?.id ?? null,
            scheduled: true,
          }),
        ],
      );
      await appendAudit(tx, {
        actor: { type: 'SYSTEM' },
        action: 'RATE_CARD_ACTIVATED',
        objectType: OBJECT,
        objectId: row.id,
        outcome: 'SUCCESS',
        reasonCode: 'SCHEDULED',
      });
      deps.log.info(
        {
          signal: 'RATE_CARD_ACTIVATED',
          rateCardId: row.id,
          cityCode: due.city_code,
          productCode: due.product_code,
          version: row.version,
          actor: 'SYSTEM',
          scheduled: true,
        },
        'rate card activated',
      );
      return 'APPLIED';
    });

  return {
    kind: 'rate-card',
    async runDue(): Promise<ActivationOutcome> {
      const due = await deps.pool.query<DueCard>(
        `select id, city_code, product_code from pricing.rate_cards where scheduled and status = 'APPROVED' and effective_from <= now() order by effective_from, id limit $1`,
        [BATCH],
      );
      let applied = 0;
      let refused = 0;
      for (const d of due.rows) {
        const result = await activateOne(d);
        if (result === 'APPLIED') applied++;
        if (result === 'REFUSED') refused++;
      }
      return { applied, refused };
    },
  };
}
