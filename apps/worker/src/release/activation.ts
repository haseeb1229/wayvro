/**
 * `config.scheduled-activation` (PHASE3_ARCHITECTURE §3.4; ADR-042 jobs): one recurring job (every minute) that runs a
 * small registry of activators. Each activator owns one configuration kind (app version policies and runtime-switch
 * expiry now; rate cards, zone sets and eligibility rules register their own activator in their phase) and must be
 * idempotent: it re-reads what is due, takes the same advisory lock as the staff path, compare-and-sets the status and
 * re-checks every activation rule at run time. Every activator runs even when another fails; any failure fails the
 * job (bounded retries, then DEAD + alert) with a stable code.
 */
import type { Logger } from '@wayvro/observability';
import { JobError, type JobDefinition } from '@wayvro/server-runtime';

export const SCHEDULED_ACTIVATION_JOB = 'config.scheduled-activation';

export interface ActivationOutcome {
  /** Objects whose due change was applied. */
  readonly applied: number;
  /** Objects whose due change was refused at run time (unscheduled, audited, alert signal). */
  readonly refused: number;
}

export interface ScheduledActivator {
  /** Stable kind, e.g. `app-policy`, `runtime-switch-expiry` (log label only). */
  readonly kind: string;
  runDue(): Promise<ActivationOutcome>;
}

export function scheduledActivationJob(activators: readonly ScheduledActivator[], log: Logger): JobDefinition {
  const kinds = new Set<string>();
  for (const a of activators) {
    if (kinds.has(a.kind)) throw new Error(`duplicate scheduled activator kind ${a.kind}`);
    kinds.add(a.kind);
  }
  return {
    type: SCHEDULED_ACTIVATION_JOB,
    async handler() {
      const failed: string[] = [];
      for (const activator of activators) {
        try {
          const outcome = await activator.runDue();
          if (outcome.applied > 0 || outcome.refused > 0) log.info({ kind: activator.kind, ...outcome }, 'scheduled activation pass');
        } catch (e) {
          failed.push(activator.kind);
          log.error({ err: e, kind: activator.kind, signal: 'SCHEDULED_ACTIVATION_FAILED' }, 'scheduled activator failed');
        }
      }
      if (failed.length > 0) throw new JobError('SCHEDULED_ACTIVATION_FAILED');
    },
  };
}
