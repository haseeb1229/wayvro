/**
 * Receiver-side idempotent point store keyed by (runId, seq) (protocol §5.3): each seq is stored once; re-sent points
 * (retries after a lost response, replays after reconnect) are counted as duplicates and never stored twice.
 */
export type SeqOutcome = 'stored' | 'duplicate';

export class SeqStore {
  private readonly runs = new Map<string, Set<number>>();

  add(runId: string, seq: number): SeqOutcome {
    let seen = this.runs.get(runId);
    if (!seen) {
      seen = new Set<number>();
      this.runs.set(runId, seen);
    }
    if (seen.has(seq)) return 'duplicate';
    seen.add(seq);
    return 'stored';
  }

  has(runId: string, seq: number): boolean {
    return this.runs.get(runId)?.has(seq) ?? false;
  }

  count(runId: string): number {
    return this.runs.get(runId)?.size ?? 0;
  }
}
