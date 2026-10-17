import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backoffDelayMs, UPLOAD_BACKOFF } from '../src/shared/backoff.ts';
import { RingBuffer } from '../src/shared/ring-buffer.ts';
import { SeqStore } from '../src/shared/seq-store.ts';

describe('idempotent seq store', () => {
  it('stores each (runId, seq) once and reports duplicates', () => {
    const s = new SeqStore();
    assert.equal(s.add('run-a', 1), 'stored');
    assert.equal(s.add('run-a', 2), 'stored');
    assert.equal(s.add('run-a', 1), 'duplicate');
    assert.equal(s.add('run-b', 1), 'stored', 'the same seq in another run is a different point');
    assert.equal(s.count('run-a'), 2);
    assert.equal(s.count('run-b'), 1);
    assert.equal(s.has('run-a', 2), true);
    assert.equal(s.has('run-c', 1), false);
  });

  it('a replayed batch (retry after a lost response) stores nothing twice', () => {
    const s = new SeqStore();
    const batch = [1, 2, 3, 4, 5];
    const first = batch.map((q) => s.add('run-x', q));
    const replay = batch.map((q) => s.add('run-x', q));
    assert.deepEqual(first, ['stored', 'stored', 'stored', 'stored', 'stored']);
    assert.deepEqual(replay, ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    assert.equal(s.count('run-x'), 5);
  });
});

describe('720-point ring buffer', () => {
  const pt = (seq: number) => ({ seq });

  it('drops the oldest on overflow and counts every drop', () => {
    const b = new RingBuffer<{ seq: number }>(720);
    for (let i = 1; i <= 800; i += 1) b.push(pt(i));
    assert.equal(b.size, 720);
    assert.equal(b.drops, 80);
    assert.equal(b.peek(1)[0]?.seq, 81);
  });

  it('removes acknowledged seqs even if some were dropped meanwhile', () => {
    const b = new RingBuffer<{ seq: number }>(3);
    [1, 2, 3].forEach((q) => b.push(pt(q)));
    const inFlight = new Set(b.peek(2).map((p) => p.seq));
    b.push(pt(4)); // drops 1 while 1 and 2 are in flight
    b.removeSeqs(inFlight);
    assert.deepEqual(
      b.peek(10).map((p) => p.seq),
      [3, 4],
    );
    assert.equal(b.drops, 1);
  });

  it('rejects a non-positive capacity', () => {
    assert.throws(() => new RingBuffer(0));
  });
});

describe('bounded exponential backoff with jitter', () => {
  it('is zero before the first failure and never exceeds the cap', () => {
    assert.equal(backoffDelayMs(0, UPLOAD_BACKOFF), 0);
    for (let f = 1; f <= 50; f += 1) {
      assert.ok(backoffDelayMs(f, UPLOAD_BACKOFF, () => 1) <= UPLOAD_BACKOFF.maxMs);
    }
  });

  it('keeps half of the exponential delay fixed (no zero-delay retry storm)', () => {
    assert.equal(
      backoffDelayMs(1, UPLOAD_BACKOFF, () => 0),
      1_000,
    );
    assert.equal(
      backoffDelayMs(1, UPLOAD_BACKOFF, () => 1),
      2_000,
    );
    assert.equal(
      backoffDelayMs(3, UPLOAD_BACKOFF, () => 0),
      4_000,
    );
    assert.equal(
      backoffDelayMs(3, UPLOAD_BACKOFF, () => 1),
      8_000,
    );
    assert.equal(
      backoffDelayMs(10, UPLOAD_BACKOFF, () => 0),
      30_000,
    );
    assert.equal(
      backoffDelayMs(10, UPLOAD_BACKOFF, () => 1),
      60_000,
    );
  });
});
