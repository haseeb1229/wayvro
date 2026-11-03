/** The scheduled-activation job runs every registered activator, isolates failures and fails with a stable code. */
import { randomUUID } from 'node:crypto';
import { createLogger } from '@wayvro/observability';
import { JobError, type ClaimedJob } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { describe, expect, it } from 'vitest';
import { SCHEDULED_ACTIVATION_JOB, scheduledActivationJob, type ScheduledActivator } from '../src/release/activation.js';

const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
const job: ClaimedJob = {
  id: randomUUID(),
  type: SCHEDULED_ACTIVATION_JOB,
  payload: {},
  sealedPayload: null,
  attempts: 1,
  maxAttempts: 3,
  leaseToken: randomUUID(),
};

describe('config.scheduled-activation', () => {
  it('runs every activator even when one fails, then fails the job with a stable code', async () => {
    const ran: string[] = [];
    const ok = (kind: string, applied = 0): ScheduledActivator => ({
      kind,
      runDue: () => {
        ran.push(kind);
        return Promise.resolve({ applied, refused: 0 });
      },
    });
    const broken: ScheduledActivator = {
      kind: 'broken',
      runDue: () => {
        ran.push('broken');
        return Promise.reject(new Error('boom'));
      },
    };
    const definition = scheduledActivationJob([ok('first', 1), broken, ok('last')], log);
    expect(definition.type).toBe('config.scheduled-activation');
    await expect(definition.handler(job)).rejects.toEqual(new JobError('SCHEDULED_ACTIVATION_FAILED'));
    expect(ran).toEqual(['first', 'broken', 'last']);
    expect(logs.text()).toContain('SCHEDULED_ACTIVATION_FAILED');
    await expect(scheduledActivationJob([ok('a'), ok('b')], log).handler(job)).resolves.toBeUndefined();
  });

  it('refuses two activators of the same kind', () => {
    const a: ScheduledActivator = { kind: 'same', runDue: () => Promise.resolve({ applied: 0, refused: 0 }) };
    expect(() => scheduledActivationJob([a, a], log)).toThrow(/duplicate scheduled activator kind/);
  });
});
