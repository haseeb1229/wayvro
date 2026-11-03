/**
 * Bounded on-device buffer (protocol §5.3): capacity 720 points; overflow drops the OLDEST point and counts the drop,
 * so memory stays bounded and drops are measured, never hidden. Items are kept in insertion (= seq) order.
 */
export class RingBuffer<T extends { readonly seq: number }> {
  private items: T[] = [];
  private dropped = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer');
    this.capacity = capacity;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
      this.dropped += 1;
    }
  }

  /** The oldest `n` items (not removed). */
  peek(n: number): T[] {
    return this.items.slice(0, Math.max(0, n));
  }

  /** Removes every item whose seq is in `seqs` (acknowledged by the receiver); safe if some were dropped meanwhile. */
  removeSeqs(seqs: ReadonlySet<number>): void {
    if (seqs.size === 0) return;
    this.items = this.items.filter((i) => !seqs.has(i.seq));
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  get drops(): number {
    return this.dropped;
  }
}
