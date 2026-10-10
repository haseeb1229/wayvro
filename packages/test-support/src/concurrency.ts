/**
 * Concurrency harness (SP-03 template, ADR-004): every participant first prepares (e.g. acquires its own connection),
 * then waits at the barrier; all are released in the same tick so their statements reach PostgreSQL together.
 */
export function barrier(parties: number): () => Promise<void> {
  if (!Number.isInteger(parties) || parties < 1) throw new Error('parties must be a positive integer');
  let arrived = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived++;
    if (arrived === parties) release();
    return released;
  };
}

/** Runs `n` tasks that all start at the same barrier and settles every one of them (fulfilled or rejected). */
export async function race<T>(n: number, prepare: (i: number) => Promise<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  const gate = barrier(n);
  return Promise.allSettled(
    Array.from({ length: n }, async (_, i) => {
      const run = await prepare(i);
      await gate();
      return run();
    }),
  );
}
