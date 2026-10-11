/**
 * SEC-FILE (in-process part, ADR-041): unsupported/disguised formats refused before decoding, decompression bombs and
 * oversized dimensions stopped by caps, truncated input refused, polyglot payloads absent from the re-encoded output,
 * EXIF/GPS/XMP/ICC/text metadata absent (checked by an INDEPENDENT segment/chunk reader written for this test only),
 * orientation baked in, canonical bounds, determinism, and the stdin/stdout/exit-code protocol. Every input is generated
 * here and is synthetic. The same pipeline runs inside the isolated container (apps/worker vault integration test).
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, encodeFrame, runSanitiser } from './run.js';
import { SANITISER_LIMITS, SanitiseError, sanitiseImage, sniffFormat } from './sanitise.js';

/** Independent metadata reader: JPEG APPn/COM segments and PNG ancillary chunks (test-only; not a security boundary). */
function metadataMarkers(b: Buffer): string[] {
  const found: string[] = [];
  if (sniffFormat(b) === 'JPEG') {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1] ?? 0;
      if (marker === 0xda) break;
      if (marker >= 0xe1 && marker <= 0xef) found.push(`APP${String(marker - 0xe0)}`);
      if (marker === 0xfe) found.push('COM');
      i += 2 + b.readUInt16BE(i + 2);
    }
  } else if (sniffFormat(b) === 'PNG') {
    let i = 8;
    while (i + 8 < b.length) {
      const length = b.readUInt32BE(i);
      const type = b.subarray(i + 4, i + 8).toString('latin1');
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP', 'tIME'].includes(type)) found.push(type);
      i += 12 + length;
    }
  }
  return found;
}

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 40 } } });
const noisy = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } } });
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => 'ACCEPTED',
    (e: unknown) => (e instanceof SanitiseError ? e.reason : 'OTHER'),
  );
function* chunks(...parts: Buffer[]): Iterable<Uint8Array> {
  for (const p of parts) yield p;
}

describe('format allowlist (magic bytes + blocked libvips loaders)', () => {
  it('sniffs only JPEG and PNG', async () => {
    expect(sniffFormat(await solid(4, 4).jpeg().toBuffer())).toBe('JPEG');
    expect(sniffFormat(await solid(4, 4).png().toBuffer())).toBe('PNG');
    expect(sniffFormat(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffFormat(new Uint8Array())).toBeNull();
  });

  it('refuses SVG, PDF-as-JPEG, WebP, TIFF, AVIF/HEIF and GIF before decoding', async () => {
    const inputs: Record<string, Buffer> = {
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      pdf: Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n'),
      webp: await solid(16, 16).webp().toBuffer(),
      tiff: await solid(16, 16).tiff().toBuffer(),
      avif: await solid(16, 16).avif().toBuffer(),
      gif: await solid(16, 16).gif().toBuffer(),
    };
    for (const [name, bytes] of Object.entries(inputs)) expect(await rejection(sanitiseImage(bytes)), name).toBe('UNSUPPORTED_FORMAT');
  });

  it('refuses a non-PNG body behind a PNG signature (decoder disagrees with the magic bytes)', async () => {
    const webp = await solid(16, 16).webp().toBuffer();
    const disguised = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), webp]);
    expect(await rejection(sanitiseImage(disguised))).not.toBe('ACCEPTED');
  });

  it('keeps every non-JPEG/PNG loader blocked at library level', async () => {
    await sanitiseImage(await solid(8, 8).png().toBuffer());
    const webp = await solid(8, 8).webp().toBuffer();
    await expect(sharp(webp).metadata()).rejects.toThrow(/unsupported image format/i);
  });
});

describe('resource limits (decompression bombs, dimensions, bytes)', () => {
  it('stops a high-ratio PNG bomb by the pixel cap without decoding it', async () => {
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 0, g: 0, b: 0 } }, limitInputPixels: false })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(SANITISER_LIMITS.maxInputBytes);
    expect(await rejection(sanitiseImage(bomb))).toBe('LIMITS');
  });

  it('refuses a side longer than the dimension cap, an empty input and an input over the byte cap', async () => {
    const strip = await solid(10_001, 2).png().toBuffer();
    expect(await rejection(sanitiseImage(strip))).toBe('LIMITS');
    expect(await rejection(sanitiseImage(new Uint8Array()))).toBe('LIMITS');
    const small = { ...SANITISER_LIMITS, maxInputBytes: 64 };
    expect(await rejection(sanitiseImage(await solid(64, 64).jpeg().toBuffer(), small))).toBe('LIMITS');
  });

  it('refuses truncated input (failOn: warning)', async () => {
    const jpeg = await noisy(400, 300).jpeg().toBuffer();
    expect(await rejection(sanitiseImage(jpeg.subarray(0, Math.floor(jpeg.length * 0.6))))).toBe('UNREADABLE');
    const png = await noisy(200, 200).png().toBuffer();
    expect(await rejection(sanitiseImage(png.subarray(0, Math.floor(png.length * 0.5))))).toBe('UNREADABLE');
  });
});

describe('canonical output (metadata absent by construction, verified independently)', () => {
  it('JPEG: EXIF incl. GPS, ICC and XMP are absent from the output', async () => {
    const tagged = await solid(320, 200)
      .withExif({
        IFD0: { Make: 'SyntheticCam', Model: 'X1', Copyright: 'synthetic' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 31/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '74/1 21/1 0/1' },
      })
      .withIccProfile('p3')
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">SECRET-XMP</rdf:RDF></x:xmpmeta>')
      .jpeg()
      .toBuffer();
    expect(metadataMarkers(tagged).length).toBeGreaterThanOrEqual(3);
    const out = await sanitiseImage(tagged);
    expect(out.format).toBe('JPEG');
    expect(metadataMarkers(out.bytes)).toEqual([]);
    expect(out.bytes.includes('SECRET-XMP')).toBe(false);
    expect(out.bytes.includes('SyntheticCam')).toBe(false);
  });

  it('PNG: text, eXIf and ICC chunks are absent; PNG input stays PNG', async () => {
    const png = await solid(64, 64).withMetadata().png().toBuffer();
    const data = Buffer.from('Comment\0SECRET-PNG-TEXT', 'latin1');
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write('tEXt', 4, 'latin1');
    data.copy(chunk, 8);
    const withText = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    expect(metadataMarkers(withText)).toContain('tEXt');
    const out = await sanitiseImage(withText);
    expect(out.format).toBe('PNG');
    expect(metadataMarkers(out.bytes)).toEqual([]);
    expect(out.bytes.includes('SECRET-PNG-TEXT')).toBe(false);
  });

  it('a polyglot (JPEG + appended ZIP) is re-encoded without the payload', async () => {
    const jpeg = await noisy(200, 120).jpeg().toBuffer();
    const polyglot = Buffer.concat([jpeg, Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('MALICIOUS-ZIP-PAYLOAD'.repeat(8))]);
    const out = await sanitiseImage(polyglot);
    expect(out.bytes.includes('MALICIOUS-ZIP-PAYLOAD')).toBe(false);
    expect(out.bytes.includes(Buffer.from('PK\x03\x04', 'latin1'))).toBe(false);
  });

  it('bakes EXIF orientation into pixels, bounds the longest side and is deterministic', async () => {
    const rotated = await solid(300, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const upright = await sanitiseImage(rotated);
    expect([upright.width, upright.height]).toEqual([200, 300]);
    const big = await noisy(4000, 3000).jpeg({ quality: 92 }).toBuffer();
    const a = await sanitiseImage(big);
    const b = await sanitiseImage(big);
    expect([a.width, a.height]).toEqual([2560, 1920]);
    expect(a.bytes.equals(b.bytes)).toBe(true);
    const meta = await sharp(a.bytes).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 2560, height: 1920 });
    expect(meta.exif ?? meta.icc ?? meta.xmp).toBeUndefined();
  });

  it('fails closed when the re-encoded output breaks the output bounds', async () => {
    const tight = { ...SANITISER_LIMITS, maxOutputBytes: 100 };
    expect(await rejection(sanitiseImage(await noisy(300, 300).jpeg().toBuffer(), tight))).toBe('UNREADABLE');
  });
});

describe('stdin/stdout protocol (one image per process)', () => {
  it('frames a clean result: 4-byte header length, JSON header, canonical bytes', async () => {
    const jpeg = await noisy(120, 80).jpeg().toBuffer();
    const half = Math.floor(jpeg.length / 2);
    const { exitCode, output } = await runSanitiser(chunks(jpeg.subarray(0, half), jpeg.subarray(half)));
    expect(exitCode).toBe(EXIT_CODES.CLEAN);
    if (!output) throw new Error('no output');
    const headerLength = output.readUInt32BE(0);
    const header = JSON.parse(output.subarray(4, 4 + headerLength).toString('utf8')) as { format: string; width: number; height: number; bytes: number };
    const body = output.subarray(4 + headerLength);
    expect(header).toEqual({ format: 'JPEG', width: 120, height: 80, bytes: body.length });
    expect(sniffFormat(body)).toBe('JPEG');
    expect(encodeFrame({ format: 'PNG', width: 1, height: 1 }, Buffer.alloc(2)).readUInt32BE(0)).toBe(
      Buffer.byteLength('{"format":"PNG","width":1,"height":1,"bytes":2}'),
    );
  });

  it('maps rejections to exit codes and writes nothing', async () => {
    expect(await runSanitiser(chunks(Buffer.from('%PDF-1.7')))).toEqual({ exitCode: EXIT_CODES.UNSUPPORTED_FORMAT, output: null });
    const tooBig = { ...SANITISER_LIMITS, maxInputBytes: 10 };
    expect(await runSanitiser(chunks(Buffer.alloc(6), Buffer.alloc(6)), tooBig)).toEqual({ exitCode: EXIT_CODES.LIMITS, output: null });
    const jpeg = await noisy(200, 100).jpeg().toBuffer();
    expect(await runSanitiser(chunks(jpeg.subarray(0, 400)))).toEqual({ exitCode: EXIT_CODES.UNREADABLE, output: null });
  });
});
