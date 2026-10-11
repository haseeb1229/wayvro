/**
 * Adapter protocol tests without infrastructure: clamd answers (incl. a scripted TCP peer for timeouts/garbage),
 * sanitiser frame decoding and outcome mapping (never "clean" unless exit 0 + a well-formed JPEG/PNG frame), and the
 * hardened container configuration (SEC-FILE: no network, read-only, no capabilities, non-root, limits, no env/volumes).
 * The real services are exercised by `test/adapters.integration.test.ts`.
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamdScanner, ScannerUnavailableError, parseClamdAnswer } from './clamd.js';
import { decodeFrame, dockerRunArgs, interpretRun, SanitiserUnavailableError } from './docker-sanitiser.js';

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
/** A scripted clamd peer on an ephemeral port (half-open: it can stay silent after the client ends its stream). */
async function peer(onData: (socket: net.Socket, received: Buffer) => void): Promise<number> {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    let received: Buffer = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      received = Buffer.concat([received, d]);
      onData(socket, received);
    });
    socket.on('error', () => undefined);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as net.AddressInfo).port;
}

const frame = (header: object, body: Buffer) => {
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([len, json, body]);
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe('clamd INSTREAM', () => {
  it('parses OK, FOUND and refuses anything else', () => {
    expect(parseClamdAnswer('stream: OK\0')).toEqual({ verdict: 'CLEAN' });
    expect(parseClamdAnswer('stream: Eicar-Test-Signature FOUND\0')).toEqual({ verdict: 'FOUND', signature: 'Eicar-Test-Signature' });
    expect(() => parseClamdAnswer('INSTREAM size limit exceeded. ERROR\0')).toThrow(ScannerUnavailableError);
    expect(() => parseClamdAnswer('')).toThrow(ScannerUnavailableError);
  });

  it('frames the stream in chunks with a zero terminator and reads the verdict', async () => {
    let seen: Buffer = Buffer.alloc(0);
    const port = await peer((socket, received) => {
      seen = received;
      if (received.subarray(-4).equals(Buffer.alloc(4))) socket.end('stream: OK\0');
    });
    const scanner = new ClamdScanner({ host: '127.0.0.1', port, timeoutMs: 2000, chunkBytes: 4 });
    expect(await scanner.scan(Buffer.from('synthetic-bytes'))).toEqual({ verdict: 'CLEAN' });
    expect(seen.subarray(0, 10).toString('latin1')).toBe('zINSTREAM\0');
    expect(seen.readUInt32BE(10)).toBe(4);
  });

  it('a silent, garbage-speaking or unreachable scanner throws (retry, never clean)', async () => {
    const silent = await peer(() => undefined);
    await expect(new ClamdScanner({ host: '127.0.0.1', port: silent, timeoutMs: 200 }).scan(Buffer.from('x'))).rejects.toThrow(/timed out/);
    const noisy = await peer((socket) => socket.write('x'.repeat(5000)));
    await expect(new ClamdScanner({ host: '127.0.0.1', port: noisy, timeoutMs: 2000 }).scan(Buffer.from('x'))).rejects.toThrow(/too long/);
    const closed = await peer(() => undefined);
    servers.pop()?.close();
    await expect(new ClamdScanner({ host: '127.0.0.1', port: closed, timeoutMs: 1000 }).scan(Buffer.from('x'))).rejects.toThrow(ScannerUnavailableError);
    expect(await new ClamdScanner({ host: '127.0.0.1', port: closed, timeoutMs: 1000 }).ping()).toBe(false);
  });

  it('ping answers PONG', async () => {
    const port = await peer((socket) => socket.end('PONG\0'));
    expect(await new ClamdScanner({ host: '127.0.0.1', port, timeoutMs: 1000 }).ping()).toBe(true);
  });
});

describe('sanitiser container protocol', () => {
  it('decodes only well-formed frames whose body matches the declared format and length', () => {
    expect(decodeFrame(frame({ format: 'JPEG', width: 2, height: 3, bytes: JPEG.length }, JPEG))).toMatchObject({ format: 'JPEG', width: 2, height: 3 });
    expect(decodeFrame(frame({ format: 'PNG', width: 1, height: 1, bytes: PNG.length }, PNG))?.format).toBe('PNG');
    expect(decodeFrame(frame({ format: 'PNG', width: 1, height: 1, bytes: JPEG.length }, JPEG))).toBeNull();
    expect(decodeFrame(frame({ format: 'JPEG', width: 1, height: 1, bytes: PNG.length }, PNG))).toBeNull();
    expect(decodeFrame(frame({ format: 'GIF', width: 1, height: 1, bytes: JPEG.length }, JPEG))).toBeNull();
    expect(decodeFrame(frame({ format: 'JPEG', width: 0, height: 1, bytes: JPEG.length }, JPEG))).toBeNull();
    expect(decodeFrame(frame({ format: 'JPEG', width: 1, height: 1, bytes: 99 }, JPEG))).toBeNull();
    expect(decodeFrame(Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('{x}')]))).toBeNull();
    expect(decodeFrame(Buffer.from([0, 0, 9, 9]))).toBeNull();
    expect(decodeFrame(Buffer.from([0, 0]))).toBeNull();
  });

  it('maps exits to outcomes and never reports clean for a failure', () => {
    const ok = frame({ format: 'JPEG', width: 2, height: 2, bytes: JPEG.length }, JPEG);
    expect(interpretRun({ code: 0, timedOut: false, overflow: false, stdout: ok })).toMatchObject({ outcome: 'CLEAN', format: 'JPEG' });
    expect(interpretRun({ code: 0, timedOut: false, overflow: false, stdout: Buffer.from('junk') })).toEqual({ outcome: 'REJECTED', reason: 'UNREADABLE' });
    expect(interpretRun({ code: 10, timedOut: false, overflow: false, stdout: Buffer.alloc(0) })).toEqual({
      outcome: 'REJECTED',
      reason: 'UNSUPPORTED_FORMAT',
    });
    expect(interpretRun({ code: 11, timedOut: false, overflow: false, stdout: Buffer.alloc(0) })).toEqual({ outcome: 'REJECTED', reason: 'LIMITS' });
    expect(interpretRun({ code: 12, timedOut: false, overflow: false, stdout: Buffer.alloc(0) })).toEqual({ outcome: 'REJECTED', reason: 'UNREADABLE' });
    // OOM kill (137), crash, signal, timeout and output overflow are LIMITS — even with a valid-looking frame
    for (const run of [
      { code: 137, timedOut: false, overflow: false },
      { code: 1, timedOut: false, overflow: false },
      { code: null, timedOut: false, overflow: false },
      { code: 0, timedOut: true, overflow: false },
      { code: 0, timedOut: false, overflow: true },
    ]) {
      expect(interpretRun({ ...run, stdout: ok })).toEqual({ outcome: 'REJECTED', reason: 'LIMITS' });
    }
    for (const code of [125, 126, 127])
      expect(() => interpretRun({ code, timedOut: false, overflow: false, stdout: Buffer.alloc(0) })).toThrow(SanitiserUnavailableError);
  });

  it('runs every image in a hardened, network-less, read-only, non-root container with limits and no env or volumes', () => {
    const args = dockerRunArgs({ image: 'wayvro-sanitiser:local', timeoutMs: 1, memory: '768m', cpus: '1', maxOutputBytes: 1 }, 'wayvro-sanitise-x');
    const joined = args.join(' ');
    for (const flag of [
      '--pull never',
      '--rm',
      '-i',
      '--network none',
      '--read-only',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--user 65532:65532',
      '--memory 768m',
      '--memory-swap 768m',
      '--cpus 1',
      '--pids-limit 32',
      '--log-driver none',
    ]) {
      expect(joined).toContain(flag);
    }
    for (const forbidden of ['-e', '--env', '--env-file', '-v', '--volume', '--mount', '--privileged', '--network host', '-p', '--publish']) {
      expect(args).not.toContain(forbidden);
    }
    expect(args.at(-1)).toBe('wayvro-sanitiser:local');
  });
});
