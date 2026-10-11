/**
 * Image sanitiser core (ADR-041 §2.1). The security boundary is the decode/re-encode pipeline of a mature decoder
 * (sharp 0.35.5 / libvips) restricted to JPEG and PNG, running in an isolated, resource-limited container — never a
 * hand-written parser. Steps: byte cap → magic-byte allowlist → every other libvips loader blocked → header read with
 * pixel/dimension caps → decode with `failOn: 'warning'` and a libvips timeout → orientation baked in → canonical
 * re-encode (JPEG q88 libjpeg-turbo, or PNG for PNG input; longest side ≤ 2560 px; sRGB) → metadata absent by
 * construction (nothing is copied) → the output is re-decoded and verified before it is returned.
 */
import sharp from 'sharp';

export const SANITISER_LIMITS = {
  /** Largest accepted source object (the upload slot limit). */
  maxInputBytes: 10 * 1024 * 1024,
  /** Decompression-bomb cap enforced by libvips before pixels are allocated. */
  maxPixels: 40_000_000,
  maxDimension: 10_000,
  /** Canonical output: longest side. */
  canonicalLongestSide: 2560,
  jpegQuality: 88,
  maxOutputBytes: 8 * 1024 * 1024,
  /** libvips evaluation timeout (the container runner adds its own wall clock). */
  timeoutSeconds: 20,
} as const;
export type SanitiserLimits = { readonly [K in keyof typeof SANITISER_LIMITS]: number };

export type SanitiseRejection = 'UNSUPPORTED_FORMAT' | 'LIMITS' | 'UNREADABLE';

export class SanitiseError extends Error {
  override readonly name = 'SanitiseError';
  constructor(readonly reason: SanitiseRejection) {
    super(`image rejected: ${reason}`);
  }
}

export interface SanitisedImage {
  readonly format: 'JPEG' | 'PNG';
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
}

/** Every libvips foreign loader except JPEG and PNG (blocked at library level, defence in depth after the magic check). */
const BLOCKED_LOADERS = [
  'VipsForeignLoadSvg',
  'VipsForeignLoadHeif',
  'VipsForeignLoadWebp',
  'VipsForeignLoadTiff',
  'VipsForeignLoadGif',
  'VipsForeignLoadPdf',
  'VipsForeignLoadMagick',
  'VipsForeignLoadJp2k',
  'VipsForeignLoadJxl',
  'VipsForeignLoadFits',
  'VipsForeignLoadOpenexr',
  'VipsForeignLoadRad',
  'VipsForeignLoadMatrix',
  'VipsForeignLoadPpm',
  'VipsForeignLoadCsv',
  'VipsForeignLoadVips',
  'VipsForeignLoadAnalyze',
  'VipsForeignLoadOpenslide',
  'VipsForeignLoadNifti',
  'VipsForeignLoadDcRaw',
  'VipsForeignLoadUhdr',
];

let configured = false;
function configure(): void {
  if (configured) return;
  sharp.block({ operation: BLOCKED_LOADERS });
  sharp.cache(false);
  sharp.concurrency(1);
  configured = true;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Format by magic bytes only (JPEG SOI + marker, PNG signature); anything else is unsupported. */
export function sniffFormat(bytes: Uint8Array): 'JPEG' | 'PNG' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length > 8 && Buffer.from(bytes.buffer, bytes.byteOffset, 8).equals(PNG_SIGNATURE)) return 'PNG';
  return null;
}

/** The rejection for any failure raised while sanitising (decoder errors included); never "clean". */
export function rejectionOf(e: unknown): SanitiseRejection {
  return classify(e).reason;
}

/** Maps a decoder failure to a rejection; never "clean". */
function classify(e: unknown): SanitiseError {
  if (e instanceof SanitiseError) return e;
  const message = e instanceof Error ? e.message : '';
  if (/pixel limit|timeout|too large|memory/i.test(message)) return new SanitiseError('LIMITS');
  if (/unsupported image format/i.test(message)) return new SanitiseError('UNSUPPORTED_FORMAT');
  return new SanitiseError('UNREADABLE');
}

export async function sanitiseImage(input: Uint8Array, limits: SanitiserLimits = SANITISER_LIMITS): Promise<SanitisedImage> {
  configure();
  if (input.byteLength === 0 || input.byteLength > limits.maxInputBytes) throw new SanitiseError('LIMITS');
  const kind = sniffFormat(input);
  if (kind === null) throw new SanitiseError('UNSUPPORTED_FORMAT');
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const options = { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true, animated: false } as const;
  try {
    const header = await sharp(source, options).metadata();
    if (header.format !== kind.toLowerCase()) throw new SanitiseError('UNSUPPORTED_FORMAT');
    if (header.width > limits.maxDimension || header.height > limits.maxDimension) throw new SanitiseError('LIMITS');
    const pipeline = sharp(source, options)
      .timeout({ seconds: limits.timeoutSeconds })
      .rotate()
      .resize({ width: limits.canonicalLongestSide, height: limits.canonicalLongestSide, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb');
    const encoded = kind === 'PNG' ? pipeline.png({ compressionLevel: 6 }) : pipeline.jpeg({ quality: limits.jpegQuality, mozjpeg: false });
    const { data } = await encoded.toBuffer({ resolveWithObject: true });
    return await verify(data, kind, limits);
  } catch (e) {
    throw classify(e);
  }
}

/** Re-decodes the output and checks format, bounds and the absence of metadata before anything leaves the sanitiser. */
async function verify(data: Buffer, kind: 'JPEG' | 'PNG', limits: SanitiserLimits): Promise<SanitisedImage> {
  const sized = sniffFormat(data) === kind && data.length <= limits.maxOutputBytes;
  const out = sized ? await sharp(data, { failOn: 'warning' }).metadata() : null;
  const valid =
    out !== null &&
    out.format === kind.toLowerCase() &&
    out.width > 0 &&
    out.height > 0 &&
    out.width <= limits.canonicalLongestSide &&
    out.height <= limits.canonicalLongestSide &&
    out.exif === undefined &&
    out.icc === undefined &&
    out.xmp === undefined;
  if (!valid) throw new SanitiseError('UNREADABLE');
  return { format: kind, width: out.width, height: out.height, bytes: data };
}
