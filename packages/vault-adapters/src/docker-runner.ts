/**
 * Spawns one hardened sanitiser container per image through the Docker CLI (LOCAL DEVELOPMENT AND CI ONLY; refused
 * in staging/production by worker configuration — ADR-041 §2.2). Outcome mapping lives in ./docker-sanitiser.ts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ImageSanitiserPort, SanitiserResult } from '@wayvro/provider-interfaces';
import { SanitiserUnavailableError, dockerRunArgs, interpretRun, type DockerSanitiserConfig } from './docker-sanitiser.js';

/** Removal attempts after a kill (every 500 ms, bounded to 10 s). */
const REAP_ATTEMPTS = 20;
const REAP_INTERVAL_MS = 500;

/**
 * A killed CLI client can race the daemon: the container may still be CREATED after the first removal and, with no
 * client attached, wait on stdin forever. Removing it by name again for a bounded time makes cleanup deterministic
 * (`rm -f` of a missing container is a no-op).
 */
function reap(command: string, name: string): void {
  let left = REAP_ATTEMPTS;
  const attempt = (): void => {
    spawnSync(command, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
    left--;
    if (left > 0) setTimeout(attempt, REAP_INTERVAL_MS).unref();
  };
  attempt();
}

export class DockerSanitiser implements ImageSanitiserPort {
  constructor(private readonly config: DockerSanitiserConfig) {}

  sanitise(bytes: Uint8Array): Promise<SanitiserResult> {
    const command = this.config.dockerCommand ?? 'docker';
    const name = `wayvro-sanitise-${randomBytes(8).toString('hex')}`;
    return new Promise((resolve, reject) => {
      const child = spawn(command, dockerRunArgs(this.config, name), { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Killing the CLI client does not stop the container; remove it by name.
        spawnSync(command, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
        child.kill('SIGKILL');
      }, this.config.timeoutMs);
      child.stdout.on('data', (d: Buffer) => {
        size += d.length;
        if (size > this.config.maxOutputBytes + 1024) {
          overflow = true;
          child.stdout.destroy();
          spawnSync(command, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
          child.kill('SIGKILL');
          return;
        }
        chunks.push(d);
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new SanitiserUnavailableError('docker CLI unavailable'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // A kill can race the daemon creating the container; keep removing it once the client has gone.
        if (timedOut || overflow) reap(command, name);
        try {
          resolve(interpretRun({ code, timedOut, overflow, stdout: Buffer.concat(chunks) }));
        } catch (e) {
          reject(e instanceof Error ? e : new SanitiserUnavailableError('sanitiser failed'));
        }
      });
      // The container may exit before reading everything (rejection); a broken pipe is not an error here.
      child.stdin.on('error', () => undefined);
      child.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    });
  }
}
