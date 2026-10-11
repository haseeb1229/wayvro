import { Writable } from 'node:stream';

/** Collects structured log lines written by a logger under test (SEC-LOG canary scans). */
export interface LogCapture {
  readonly stream: Writable;
  /** Everything written so far, as one string. */
  text(): string;
  clear(): void;
}

export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    }),
    text: () => chunks.join(''),
    clear: () => {
      chunks.length = 0;
    },
  };
}
