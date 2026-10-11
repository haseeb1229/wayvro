/**
 * Isolated sanitiser runner for LOCAL DEVELOPMENT AND CI (ADR-041 §2.2): one hardened, network-less container per
 * image via the Docker CLI. It needs a Docker daemon, so worker configuration refuses it in staging/production — a
 * production worker never holds a Docker socket; hosting the same container there is activation track P2.A4.
 *
 * Outcome mapping (never "clean" unless the container exited 0 with a well-formed frame of a JPEG/PNG body):
 *   exit 0 + valid frame → CLEAN; 10/11/12 → UNSUPPORTED_FORMAT/LIMITS/UNREADABLE; 125/126/127 or spawn failure →
 *   SanitiserUnavailableError (retry: the daemon/image is unavailable); any other exit, signal (incl. OOM kill),
 *   wall-clock timeout or oversized output → LIMITS; exit 0 with a malformed frame → UNREADABLE.
 */
import type { SanitiserRejection, SanitiserResult } from '@wayvro/provider-interfaces';

export interface DockerSanitiserConfig {
  /** Image reference; pinned by digest outside local/test (enforced by worker configuration). */
  readonly image: string;
  readonly timeoutMs: number;
  readonly memory: string;
  readonly cpus: string;
  readonly maxOutputBytes: number;
  readonly dockerCommand?: string;
}

export class SanitiserUnavailableError extends Error {
  override readonly name = 'SanitiserUnavailableError';
}

const REJECTIONS: Readonly<Record<number, SanitiserRejection>> = { 10: 'UNSUPPORTED_FORMAT', 11: 'LIMITS', 12: 'UNREADABLE' };
const DOCKER_RUN_FAILURES = new Set([125, 126, 127]);

/** The hardened `docker run` argument list for one invocation (also asserted by the container-config test). */
export function dockerRunArgs(config: DockerSanitiserConfig, name: string): string[] {
  return [
    'run',
    // never pull at run time: the pinned image must already be present (a missing image is 'unavailable', exit 125)
    '--pull',
    'never',
    '--rm',
    '-i',
    '--name',
    name,
    '--label',
    'wayvro.sanitiser=1',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65532:65532',
    '--memory',
    config.memory,
    '--memory-swap',
    config.memory,
    '--cpus',
    config.cpus,
    '--pids-limit',
    '32',
    '--tmpfs',
    '/tmp:size=8m,noexec,nosuid',
    '--log-driver',
    'none',
    config.image,
  ];
}

/** Decodes the sanitiser's stdout frame; null when malformed. @internal exported for protocol tests */
export function decodeFrame(output: Buffer): { format: 'JPEG' | 'PNG'; width: number; height: number; bytes: Buffer } | null {
  if (output.length < 4) return null;
  const headerLength = output.readUInt32BE(0);
  if (headerLength < 2 || headerLength > 1024 || output.length < 4 + headerLength) return null;
  let header: unknown;
  try {
    header = JSON.parse(output.subarray(4, 4 + headerLength).toString('utf8'));
  } catch {
    return null;
  }
  const body = output.subarray(4 + headerLength);
  const h = header as { format?: unknown; width?: unknown; height?: unknown; bytes?: unknown };
  const dims = Number.isInteger(h.width) && Number.isInteger(h.height) && (h.width as number) > 0 && (h.height as number) > 0;
  if ((h.format !== 'JPEG' && h.format !== 'PNG') || !dims || h.bytes !== body.length) return null;
  const jpeg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const png = body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((h.format === 'JPEG' && !jpeg) || (h.format === 'PNG' && !png)) return null;
  return { format: h.format, width: h.width as number, height: h.height as number, bytes: body };
}

/** Maps a finished invocation to an outcome. */
export function interpretRun(run: { code: number | null; timedOut: boolean; overflow: boolean; stdout: Buffer }): SanitiserResult {
  if (run.timedOut || run.overflow) return { outcome: 'REJECTED', reason: 'LIMITS' };
  if (run.code !== null && DOCKER_RUN_FAILURES.has(run.code)) throw new SanitiserUnavailableError(`docker run failed (exit ${String(run.code)})`);
  if (run.code === 0) {
    const frame = decodeFrame(run.stdout);
    return frame ? { outcome: 'CLEAN', ...frame } : { outcome: 'REJECTED', reason: 'UNREADABLE' };
  }
  return { outcome: 'REJECTED', reason: (run.code === null ? undefined : REJECTIONS[run.code]) ?? 'LIMITS' };
}
