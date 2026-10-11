/**
 * Spawns one hardened sanitiser container per image through the Docker CLI (LOCAL DEVELOPMENT AND CI ONLY; refused
 * in staging/production by worker configuration — ADR-041 §2.2). Outcome mapping lives in ./docker-sanitiser.ts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ImageSanitiserPort, SanitiserResult } from '@wayvro/provider-interfaces';
import { SanitiserUnavailableError, dockerRunArgs, interpretRun, type DockerSanitiserConfig } from './docker-sanitiser.js';

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
        // A kill can race the daemon creating the container; remove it again once the client has gone.
        if (timedOut || overflow) spawnSync(command, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
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
