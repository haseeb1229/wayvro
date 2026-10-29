import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Presence } from '../src/shared/presence.ts';
import type { Snapshot } from '../src/shared/protocol.ts';
import { ReceiverCore } from '../receiver/core.ts';
import type { Row } from '../receiver/rows.ts';

const T0 = 1_760_000_000_000;

describe('stale/offline state machine (T_stale 20 s, T_offline 120 s)', () => {
  const make = () => new Presence({ tStaleMs: 20_000, tOfflineMs: 120_000 });

  it('ONLINE → STALE at 20 s of silence → back to ONLINE on liveness', () => {
    const p = make();
    assert.equal(p.state, 'OFFLINE');
    assert.equal(p.offlineReason, 'NEVER_ONLINE');
    assert.equal(p.goOnline(T0, 'run-aaaa1111').ok, true);
    assert.deepEqual(p.tick(T0 + 19_999), []);
    const [stale] = p.tick(T0 + 20_000);
    assert.equal(stale?.to, 'STALE');
    assert.equal(stale?.atMs, T0 + 20_000);
    const back = p.liveness(T0 + 25_000, 'run-aaaa1111');
    assert.equal(back?.to, 'ONLINE');
    assert.equal(p.state, 'ONLINE');
  });

  it('goes OFFLINE with TRACKING_LOST at 120 s of silence (through STALE)', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    const all = p.tick(T0 + 120_000);
    assert.deepEqual(
      all.map((t) => `${t.from}->${t.to}:${t.reason}`),
      ['ONLINE->STALE:LIVENESS_LOST', 'STALE->OFFLINE:TRACKING_LOST'],
    );
    assert.equal(p.offlineReason, 'TRACKING_LOST');
  });

  it('liveness never revives OFFLINE (no automatic resume); only an explicit go-online does', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    p.tick(T0 + 121_000);
    assert.equal(p.liveness(T0 + 122_000, 'run-aaaa1111'), null);
    assert.equal(p.state, 'OFFLINE');
    assert.equal(p.liveness(T0 + 122_000, 'run-other00'), null);
    assert.equal(p.goOnline(T0 + 130_000, 'run-bbbb2222').ok, true);
    assert.equal(p.state, 'ONLINE');
  });

  it('heartbeats from another run are ignored', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    p.tick(T0 + 21_000);
    assert.equal(p.liveness(T0 + 22_000, 'run-zzzz9999'), null);
    assert.equal(p.state, 'STALE');
  });

  it('restriction forces OFFLINE(RESTRICTED) and refuses go-online until lifted', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    assert.equal(p.restrict(T0 + 1_000)?.reason, 'RESTRICTED');
    const refused = p.goOnline(T0 + 2_000, 'run-bbbb2222');
    assert.equal(refused.ok, false);
    p.unrestrict();
    assert.equal(p.goOnline(T0 + 3_000, 'run-bbbb2222').ok, true);
  });

  it('same-run go-online is idempotent; a new run closes the previous one first', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    const again = p.goOnline(T0 + 1_000, 'run-aaaa1111');
    assert.deepEqual(again.ok ? again.transitions : null, []);
    const next = p.goOnline(T0 + 2_000, 'run-bbbb2222');
    assert.deepEqual(next.ok ? next.transitions.map((t) => `${t.to}:${t.reason}:${String(t.runId)}`) : null, [
      'OFFLINE:USER_OFFLINE:run-aaaa1111',
      'ONLINE:GO_ONLINE:run-bbbb2222',
    ]);
  });

  it('explicit go-offline carries the client reason; repeating it is a no-op', () => {
    const p = make();
    p.goOnline(T0, 'run-aaaa1111');
    assert.equal(p.goOffline(T0 + 1, 'PERMISSION_REVOKED')?.reason, 'PERMISSION_REVOKED');
    assert.equal(p.goOffline(T0 + 2, 'USER_OFFLINE'), null);
    assert.equal(p.offlineReason, 'PERMISSION_REVOKED');
  });

  it('rejects inconsistent thresholds', () => {
    assert.throws(() => new Presence({ tStaleMs: 120_000, tOfflineMs: 20_000 }));
  });
});

describe('receiver core (fake clock)', () => {
  function setup() {
    let now = T0;
    const rows: Row[] = [];
    const pushed: Snapshot[] = [];
    let n = 0;
    const core = new ReceiverCore({
      now: () => now,
      write: (r) => rows.push(r),
      newOfferId: () => `of-test-${String((n += 1))}`,
      onPresenceChange: (s) => pushed.push(s),
      onOffer: () => true,
    });
    return { core, rows, pushed, advance: (ms: number) => (now += ms), at: () => now };
  }
  const point = (runId: string, seq: number, fixTimeMs: number) => ({
    runId,
    seq,
    fixTimeMs,
    accuracyBucketM: 5,
    deltaMBucket: 0,
    mocked: false,
    appState: 'background' as const,
    fgsActive: true,
    batteryPct: 90,
    powerSave: false,
  });
  const batch = (runId: string, pts: ReturnType<typeof point>[]) => ({
    runId,
    points: pts,
    clock: [],
    stats: { bufferDepth: 0, bufferDrops: 0, fixesTotal: pts.length },
  });

  it('stores a replayed batch once (idempotent by runId, seq)', () => {
    const { core, rows, at } = setup();
    core.goOnline('run-aaaa1111');
    const b = batch('run-aaaa1111', [point('run-aaaa1111', 1, at()), point('run-aaaa1111', 2, at())]);
    assert.equal(core.points(b).stored, 2);
    const again = core.points(b);
    assert.equal(again.stored, 0);
    assert.equal(again.duplicates, 2);
    assert.equal(rows.filter((r) => r.k === 'point' && r.outcome === 'stored').length, 2);
  });

  it('old buffered points do not count as liveness; fresh ones do', () => {
    const { core, advance, at } = setup();
    core.goOnline('run-aaaa1111');
    advance(30_000);
    core.tick();
    assert.equal(core.snapshot('internal').presence, 'STALE');
    core.points(batch('run-aaaa1111', [point('run-aaaa1111', 1, at() - 25_000)]));
    assert.equal(core.snapshot('internal').presence, 'STALE');
    core.points(batch('run-aaaa1111', [point('run-aaaa1111', 2, at() - 1_000)]));
    assert.equal(core.snapshot('internal').presence, 'ONLINE');
  });

  it('after a forced OFFLINE accepts only points fixed before it (TC-19, TC-13 buffered upload)', () => {
    const { core, advance, at } = setup();
    core.goOnline('run-aaaa1111');
    advance(10_000);
    const before = at() - 5_000;
    core.forceOffline();
    const offAt = at();
    advance(30_000);
    const r = core.points(batch('run-aaaa1111', [point('run-aaaa1111', 1, before), point('run-aaaa1111', 2, offAt + 1_000)]));
    assert.equal(r.stored, 1);
    assert.equal(r.rejectedAfterOffline, 1);
    assert.equal(r.presence, 'OFFLINE');
    assert.equal(r.offlineReason, 'FORCED_OFFLINE');
  });

  it('emits the first offer after 60 s and then every 120 s; pending until acked or expired', () => {
    const { core, rows, advance } = setup();
    core.goOnline('run-aaaa1111');
    for (let i = 0; i < 59; i += 1) {
      advance(1_000);
      core.tick();
      core.heartbeat('run-aaaa1111');
    }
    assert.equal(rows.filter((r) => r.k === 'offer_emit').length, 0);
    advance(1_000);
    core.tick();
    const emits = rows.filter((r): r is Extract<Row, { k: 'offer_emit' }> => r.k === 'offer_emit');
    assert.equal(emits.length, 1);
    const id = emits[0]?.offerId ?? '';
    assert.deepEqual(
      core.snapshot('poll').pendingOffers.map((o) => o.offerId),
      [id],
    );
    assert.equal(core.ack(id, 'poll', 123), true);
    assert.equal(core.ack(id, 'socket', 124), true);
    const acks = rows.filter((r): r is Extract<Row, { k: 'offer_ack' }> => r.k === 'offer_ack');
    assert.deepEqual(
      acks.map((a) => a.first),
      [true, false],
    );
    assert.deepEqual(core.snapshot('internal').pendingOffers, []);
    for (let i = 0; i < 120; i += 1) {
      advance(1_000);
      core.heartbeat('run-aaaa1111');
      core.tick();
    }
    assert.equal(rows.filter((r) => r.k === 'offer_emit').length, 2);
    advance(21_000);
    core.heartbeat('run-aaaa1111');
    assert.deepEqual(core.snapshot('internal').pendingOffers, [], 'expired offers are not pending');
  });

  it('restriction pushes OFFLINE(RESTRICTED) to the socket path and refuses go-online', () => {
    const { core, pushed } = setup();
    core.goOnline('run-aaaa1111');
    core.restrict();
    const last = pushed.at(-1);
    assert.equal(last?.presence, 'OFFLINE');
    assert.equal(last?.offlineReason, 'RESTRICTED');
    assert.equal(last?.restricted, true);
    assert.equal(core.goOnline('run-bbbb2222').ok, false);
  });

  it('accepts only known client event types and safe codes', () => {
    const { core, rows } = setup();
    const accepted = core.events([
      { type: 'PERMISSION_REVOKED', deviceMs: 1, code: 'FOREGROUND' },
      { type: 'NOT_A_TYPE' as 'SIGNED_OUT', deviceMs: 2 },
      { type: 'PROVIDER_DISABLED', deviceMs: 3, code: 'free text with spaces' },
    ]);
    assert.equal(accepted, 2);
    const ev = rows.filter((r): r is Extract<Row, { k: 'client_event' }> => r.k === 'client_event');
    assert.deepEqual(
      ev.map((e) => e.code ?? null),
      ['FOREGROUND', null],
    );
  });
});
