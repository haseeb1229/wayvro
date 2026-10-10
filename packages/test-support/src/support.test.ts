import { describe, expect, it } from 'vitest';
import { barrier, captureLogs, race } from './index.js';

describe('concurrency harness', () => {
  it('releases every participant only when all have arrived', async () => {
    const gate = barrier(3);
    const order: string[] = [];
    const a = gate().then(() => order.push('a'));
    const b = gate().then(() => order.push('b'));
    await Promise.resolve();
    expect(order).toEqual([]);
    await Promise.all([a, b, gate().then(() => order.push('c'))]);
    expect(order.sort()).toEqual(['a', 'b', 'c']);
  });

  it('race settles every task, including failures', async () => {
    const results = await race(4, (i) => Promise.resolve(() => (i % 2 === 0 ? Promise.resolve(i) : Promise.reject(new Error(`odd ${String(i)}`)))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  });

  it('rejects invalid party counts', () => {
    expect(() => barrier(0)).toThrow(/positive/);
  });
});

describe('log capture', () => {
  it('collects and clears written lines', () => {
    const logs = captureLogs();
    logs.stream.write('{"msg":"one"}\n');
    expect(logs.text()).toContain('one');
    logs.clear();
    expect(logs.text()).toBe('');
  });
});
