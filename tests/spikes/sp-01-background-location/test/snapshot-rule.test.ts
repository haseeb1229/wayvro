/**
 * Stale-snapshot rule (src/shared/snapshot-rule.ts). Regression for the 2026-10-16 emulator run: an OFFLINE/RESTRICTED
 * snapshot of the PREVIOUS run, generated before the receiver accepted the new go-online, stopped the new session.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideSnapshot } from '../src/shared/snapshot-rule.ts';

const T0 = 1_792_171_562_000;
const snap = (serverTimeMs: number, presence: 'ONLINE' | 'STALE' | 'OFFLINE', runId: string | null) => ({ serverTimeMs, presence, runId });

describe('which snapshot may act on the current session', () => {
  it('without a session every snapshot is applied (sign-in, start-up, reconcile)', () => {
    assert.equal(decideSnapshot(null, snap(T0, 'OFFLINE', 'old-run-1')), 'apply');
  });

  it('the regression: an OFFLINE snapshot of the previous run arriving during go-online is ignored, not a stop', () => {
    assert.equal(decideSnapshot({ runId: 'new-run-2', confirmedServerMs: null }, snap(T0, 'OFFLINE', 'old-run-1')), 'ignore-stale');
  });

  it('a snapshot generated before the go-online was accepted is ignored even if it arrives later', () => {
    assert.equal(decideSnapshot({ runId: 'new-run-2', confirmedServerMs: T0 + 500 }, snap(T0 + 499, 'OFFLINE', 'old-run-1')), 'ignore-stale');
  });

  it('the go-online response itself (same server time) is applied', () => {
    assert.equal(decideSnapshot({ runId: 'new-run-2', confirmedServerMs: T0 }, snap(T0, 'ONLINE', 'new-run-2')), 'apply');
  });

  it('after acceptance the server stays authoritative: OFFLINE or another run stops the session', () => {
    const s = { runId: 'new-run-2', confirmedServerMs: T0 };
    assert.equal(decideSnapshot(s, snap(T0 + 1, 'OFFLINE', 'new-run-2')), 'stop');
    assert.equal(decideSnapshot(s, snap(T0 + 1, 'ONLINE', 'other-run-3')), 'stop');
    assert.equal(decideSnapshot(s, snap(T0 + 1, 'STALE', 'new-run-2')), 'apply');
  });
});
