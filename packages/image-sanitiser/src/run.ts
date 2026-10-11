/**
 * One sanitiser invocation (one image per container process, ADR-041 §2.2). Input: raw bytes on stdin, refused beyond
 * the byte cap. Output on success: a frame on stdout — 4-byte big-endian header length, UTF-8 JSON header
 * `{"format","width","height","bytes"}`, then the canonical image bytes. Exit codes are the protocol for rejections.
 */
import { SANITISER_LIMITS, rejectionOf, sanitiseImage, type SanitiseRejection, type SanitiserLimits } from './sanitise.js';

export const EXIT_CODES: Readonly<Record<'CLEAN' | SanitiseRejection, number>> = {
  CLEAN: 0,
  UNSUPPORTED_FORMAT: 10,
  LIMITS: 11,
  UNREADABLE: 12,
};
export function encodeFrame(header: { format: 'JPEG' | 'PNG'; width: number; height: number }, bytes: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify({ ...header, bytes: bytes.length }), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, bytes]);
}

/** Reads at most `max + 1` bytes so an oversized input is detected without buffering all of it. */
async function readCapped(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > max) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function runSanitiser(
  stdin: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  limits: SanitiserLimits = SANITISER_LIMITS,
): Promise<{ readonly exitCode: number; readonly output: Buffer | null }> {
  const input = await readCapped(stdin, limits.maxInputBytes);
  if (input === null) return { exitCode: EXIT_CODES.LIMITS, output: null };
  try {
    const image = await sanitiseImage(input, limits);
    return { exitCode: EXIT_CODES.CLEAN, output: encodeFrame({ format: image.format, width: image.width, height: image.height }, image.bytes) };
  } catch (e) {
    return { exitCode: EXIT_CODES[rejectionOf(e)], output: null };
  }
}
