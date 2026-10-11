/**
 * clamd INSTREAM malware scanner adapter (ADR-041 §2.5) over `node:net`: `zINSTREAM\0`, then chunks of
 * <4-byte big-endian length><bytes>, then a zero-length terminator; clamd answers `stream: OK`, `stream: <sig> FOUND`
 * or an error. Any transport failure, timeout or unexpected answer THROWS `ScannerUnavailableError` — the object is
 * retried and never treated as clean.
 */
import net from 'node:net';
import type { MalwareScannerPort, ScanVerdict } from '@wayvro/provider-interfaces';

export interface ClamdConfig {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  /** Chunk size per INSTREAM frame (clamd StreamMaxLength still bounds the total). */
  readonly chunkBytes?: number;
}

export class ScannerUnavailableError extends Error {
  override readonly name = 'ScannerUnavailableError';
}

/** Parses one clamd INSTREAM answer. @internal exported for protocol tests */
export function parseClamdAnswer(answer: string): ScanVerdict {
  const line = answer.replace(/\0/g, '').trim();
  if (line === 'stream: OK') return { verdict: 'CLEAN' };
  const found = /^stream: (.{1,200}) FOUND$/.exec(line);
  if (found?.[1]) return { verdict: 'FOUND', signature: found[1] };
  throw new ScannerUnavailableError('unexpected clamd answer');
}

export class ClamdScanner implements MalwareScannerPort {
  constructor(private readonly config: ClamdConfig) {}

  private exchange(write: (socket: net.Socket) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.config.host, port: this.config.port });
      let answer = '';
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve(answer);
      };
      socket.setTimeout(this.config.timeoutMs, () => {
        finish(new ScannerUnavailableError('clamd timed out'));
      });
      socket.on('data', (d: Buffer) => {
        answer += d.toString('latin1');
        if (answer.length > 4096) finish(new ScannerUnavailableError('clamd answer too long'));
      });
      socket.on('end', () => {
        finish(null);
      });
      socket.on('error', () => {
        finish(new ScannerUnavailableError('clamd unreachable'));
      });
      socket.on('connect', () => {
        write(socket);
      });
    });
  }

  async scan(bytes: Uint8Array): Promise<ScanVerdict> {
    const chunk = this.config.chunkBytes ?? 64 * 1024;
    const answer = await this.exchange((socket) => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.byteLength; i += chunk) {
        const part = bytes.subarray(i, Math.min(i + chunk, bytes.byteLength));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.byteLength);
        socket.write(length);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
    return parseClamdAnswer(answer);
  }

  /** Readiness probe (`zPING` → `PONG`). */
  async ping(): Promise<boolean> {
    try {
      const answer = await this.exchange((socket) => socket.end('zPING\0'));
      return answer.replace(/\0/g, '').trim() === 'PONG';
    } catch {
      return false;
    }
  }
}
