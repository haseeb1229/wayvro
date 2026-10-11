/**
 * Vault adapters against REAL local services (ADR-041): SeaweedFS (S3 API), ClamAV clamd, and the isolated sanitiser
 * container. Covers SEC-URL (quarantine-only presigned PUT; content type, length, key and expiry are enforced by the
 * signature; no checksum parameters — ADR-010 finding re-verified), area isolation, the EICAR test string, and the
 * container half of SEC-FILE (clean re-encode without metadata, refusals, wall-clock kill, missing image ⇒ unavailable).
 * Every input is synthetic and generated here; the EICAR string is assembled at run time.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClamdScanner } from '../src/clamd.js';
import { DockerSanitiser } from '../src/docker-runner.js';
import { SanitiserUnavailableError } from '../src/docker-sanitiser.js';
import { S3ObjectStorage } from '../src/s3.js';

const S3_ENDPOINT = process.env['WAYVRO_S3_ENDPOINT'] ?? 'http://127.0.0.1:28333';
const CLAMD_PORT = Number(process.env['WAYVRO_CLAMAV_PORT'] ?? '23310');
const IMAGE = process.env['WAYVRO_SANITISER_IMAGE'] ?? 'wayvro-sanitiser:local';
const run = randomBytes(4).toString('hex');

const storage = new S3ObjectStorage({
  endpoint: S3_ENDPOINT,
  region: 'us-east-1',
  accessKeyId: 'wayvro-local-access',
  secretAccessKey: 'wayvro-local-secret-not-for-production',
  forcePathStyle: true,
  areas: { quarantine: { bucket: 'wayvro-local', prefix: `it-${run}/quarantine/` }, vault: { bucket: 'wayvro-local', prefix: `it-${run}/vault/` } },
  maxUploadUrlSeconds: 300,
  requestTimeoutMs: 10000,
});
const key = (p: string) => `${p}/${randomBytes(16).toString('hex')}`;
const sanitiser = (overrides: Partial<ConstructorParameters<typeof DockerSanitiser>[0]> = {}) =>
  new DockerSanitiser({ image: IMAGE, timeoutMs: 60000, memory: '768m', cpus: '1', maxOutputBytes: 8 * 1024 * 1024, ...overrides });
const noisy = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } } });

beforeAll(() => {
  try {
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
  } catch {
    throw new Error(`sanitiser image ${IMAGE} is missing: run \`pnpm --filter @wayvro/image-sanitiser build && node scripts/sanitiser-image.mjs\``);
  }
});

describe('S3 object storage on SeaweedFS', () => {
  it('stores, reads, heads, lists and deletes per area; areas are isolated', async () => {
    const k = key('v');
    await storage.putObject({ area: 'vault', key: k, body: Buffer.from('ciphertext-bytes'), contentType: 'application/octet-stream' });
    expect(Buffer.from((await storage.getObject({ area: 'vault', key: k })) ?? []).toString()).toBe('ciphertext-bytes');
    expect(await storage.headObject({ area: 'vault', key: k })).toEqual({ size: 16, contentType: 'application/octet-stream' });
    expect(await storage.getObject({ area: 'quarantine', key: k })).toBeNull();
    expect(await storage.headObject({ area: 'quarantine', key: k })).toBeNull();
    expect((await storage.listObjects({ area: 'vault', prefix: 'v/', limit: 50 })).map((o) => o.key)).toContain(k);
    await storage.deleteObject({ area: 'vault', key: k });
    await storage.deleteObject({ area: 'vault', key: k });
    expect(await storage.getObject({ area: 'vault', key: k })).toBeNull();
    await expect(storage.putObject({ area: 'vault', key: '../escape', body: Buffer.alloc(1), contentType: 'x' })).rejects.toThrow(/invalid object key/);
  });
});

describe('SEC-URL: quarantine-only presigned uploads', () => {
  const body = Buffer.from('synthetic upload bytes 0123456789');

  it('accepts exactly the signed type and length into quarantine, without checksum parameters', async () => {
    const k = key('q');
    const up = await storage.createUploadUrl({ key: k, contentType: 'image/jpeg', contentLength: body.length, expiresInSeconds: 120 });
    const url = new URL(up.url);
    expect(url.pathname).toContain(`it-${run}/quarantine/`);
    expect([...url.searchParams.keys()].some((p) => /checksum/i.test(p))).toBe(false);
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';').sort()).toEqual(['content-length', 'content-type', 'host']);
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(120);
    const res = await fetch(up.url, { method: 'PUT', headers: up.headers, body });
    expect(res.status).toBe(200);
    expect(await storage.headObject({ area: 'quarantine', key: k })).toMatchObject({ size: body.length, contentType: 'image/jpeg' });
    expect(await storage.headObject({ area: 'vault', key: k })).toBeNull();
  });

  it('refuses another type, another length, another key and an expired URL; expiry is capped', async () => {
    const k = key('q');
    const up = await storage.createUploadUrl({ key: k, contentType: 'image/jpeg', contentLength: body.length, expiresInSeconds: 120 });
    expect((await fetch(up.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body })).status).toBe(403);
    expect((await fetch(up.url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: Buffer.concat([body, Buffer.from('x')]) })).status).toBe(403);
    const other = new URL(up.url);
    other.pathname = other.pathname.replace(/[0-9a-f]{32}$/, randomBytes(16).toString('hex'));
    expect((await fetch(other, { method: 'PUT', headers: up.headers, body })).status).toBe(403);
    expect(await storage.headObject({ area: 'quarantine', key: k })).toBeNull();
    const short = await storage.createUploadUrl({ key: key('q'), contentType: 'image/jpeg', contentLength: body.length, expiresInSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(short.url, { method: 'PUT', headers: short.headers, body })).status).toBe(403);
    const capped = await storage.createUploadUrl({ key: key('q'), contentType: 'image/jpeg', contentLength: 1, expiresInSeconds: 86400 });
    expect(Number(new URL(capped.url).searchParams.get('X-Amz-Expires'))).toBe(300);
  });
});

describe('ClamAV clamd INSTREAM', () => {
  const scanner = new ClamdScanner({ host: '127.0.0.1', port: CLAMD_PORT, timeoutMs: 30000 });

  it('flags the EICAR test string and passes clean synthetic bytes', async () => {
    const eicar = Buffer.from(`X5O!P%@AP[4${String.fromCharCode(92)}PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`, 'latin1');
    expect(eicar.length).toBe(68);
    expect(await scanner.ping()).toBe(true);
    expect(await scanner.scan(eicar)).toMatchObject({ verdict: 'FOUND', signature: expect.stringMatching(/eicar/i) });
    expect(await scanner.scan(await noisy(64, 64).jpeg().toBuffer())).toEqual({ verdict: 'CLEAN' });
  });
});

describe('SEC-FILE in the isolated container', () => {
  it('re-encodes a clean JPEG without metadata', async () => {
    const tagged = await noisy(800, 600)
      .withExif({ IFD0: { Make: 'SyntheticCam' } })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-XMP</x:xmpmeta>')
      .jpeg()
      .toBuffer();
    const result = await sanitiser().sanitise(tagged);
    if (result.outcome !== 'CLEAN') throw new Error(`expected CLEAN, got ${result.reason}`);
    expect(result).toMatchObject({ format: 'JPEG', width: 800, height: 600 });
    const out = Buffer.from(result.bytes);
    expect(out.includes('SyntheticCam') || out.includes('SECRET-XMP') || out.includes('Exif')).toBe(false);
    const meta = await sharp(out).metadata();
    expect(meta.exif ?? meta.xmp ?? meta.icc).toBeUndefined();
  });

  it('refuses disguised formats, bombs and truncated files — never clean', async () => {
    const s = sanitiser();
    expect(await s.sanitise(Buffer.from('%PDF-1.7 synthetic'))).toEqual({ outcome: 'REJECTED', reason: 'UNSUPPORTED_FORMAT' });
    expect(await s.sanitise(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ outcome: 'REJECTED', reason: 'UNSUPPORTED_FORMAT' });
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 0, g: 0, b: 0 } }, limitInputPixels: false })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await s.sanitise(bomb)).toEqual({ outcome: 'REJECTED', reason: 'LIMITS' });
    const jpeg = await noisy(300, 200).jpeg().toBuffer();
    expect(await s.sanitise(jpeg.subarray(0, 500))).toEqual({ outcome: 'REJECTED', reason: 'UNREADABLE' });
  });

  it('a wall-clock timeout kills and removes the container (LIMITS); an oversized output is LIMITS', async () => {
    const jpeg = await noisy(2000, 1500).jpeg().toBuffer();
    expect(await sanitiser({ timeoutMs: 50 }).sanitise(jpeg)).toEqual({ outcome: 'REJECTED', reason: 'LIMITS' });
    expect(await sanitiser({ maxOutputBytes: 10 }).sanitise(jpeg)).toEqual({ outcome: 'REJECTED', reason: 'LIMITS' });
    const leftovers = () => execFileSync('docker', ['ps', '-a', '--filter', 'label=wayvro.sanitiser=1', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
    for (let i = 0; i < 20 && leftovers() !== ''; i++) await new Promise((r) => setTimeout(r, 500));
    expect(leftovers()).toBe('');
  });

  it('a missing image or Docker CLI is "unavailable" (retry), never a verdict', async () => {
    const jpeg = await noisy(32, 32).jpeg().toBuffer();
    await expect(sanitiser({ image: 'wayvro-sanitiser:missing-image' }).sanitise(jpeg)).rejects.toBeInstanceOf(SanitiserUnavailableError);
    await expect(sanitiser({ dockerCommand: 'wayvro-no-such-docker-cli' }).sanitise(jpeg)).rejects.toBeInstanceOf(SanitiserUnavailableError);
  });
});
