import pg from 'pg';

export const DATABASE_URL =
  process.env['SP03_DATABASE_URL'] ?? 'postgres://spike:spike-local-only@127.0.0.1:55432/sp03';

export function newPool(max: number): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URL, max });
}

export function percentiles(samplesMs: number[]): { n: number; p50: number; p95: number; p99: number; max: number; mean: number } {
  const s = [...samplesMs].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? Number.NaN;
  const round = (x: number): number => Math.round(x * 1000) / 1000;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(s[s.length - 1] ?? Number.NaN), mean: round(mean) };
}

/** Deterministic PRNG (mulberry32) so every run uses the same synthetic pickup points. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
