/**
 * placeRef sealing (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §7; threat model T3-07; UNIT-PLACEREF).
 *
 *   token     = "pr1." + base64url( tokenId (16 bytes, UUIDv7) ‖ envelope v1 )
 *   envelope  = FieldCipher.encrypt('place_refs', canonical JSON, { field: 'geo.place_refs.token', rowId: tokenId,
 *               fieldSchemaVersion: 1 }) — AES-256-GCM, fresh nonce, AAD bound to the token id and key id
 *   plaintext = {"v":1,"pk":…,"sku":…,"pid":…,"acct":…,"city":…,"exp":…} (fixed key order)
 *
 * `city` is an additive field beyond the §7 sketch: the resolve route has no city parameter, and the service-area
 * flag it returns needs the city the suggestion was made for. Provider ids never reach the client in clear; tokens
 * are never stored in PostgreSQL and are not a cache. Opening fails closed with a typed reason; a token issued to
 * another account fails exactly like a forged one (PLACE_REF_INVALID — no oracle).
 */
import { FieldDecryptionError, type FieldCipher } from '@wayvro/field-crypto';
import { uuidv7 } from '@wayvro/server-runtime';
import { z } from 'zod';

export type PlaceRefFailure = 'PLACE_REF_INVALID' | 'PLACE_REF_EXPIRED' | 'PLACE_REF_STALE';

export class PlaceRefError extends Error {
  override readonly name = 'PlaceRefError';
  constructor(readonly reason: PlaceRefFailure) {
    super(reason);
  }
}

export interface PlaceRefClaims {
  readonly providerKey: string;
  /** The SKU that produced the suggestion (AUTOCOMPLETE: provider place id; GEOCODE: held-result reference). */
  readonly sku: 'AUTOCOMPLETE' | 'GEOCODE';
  readonly placeId: string;
  readonly accountId: string;
  readonly cityCode: string;
}

const FIELD = { field: 'geo.place_refs.token', fieldSchemaVersion: 1 } as const;
const TOKEN = /^pr1\.([A-Za-z0-9_-]{40,512})$/;
/** Longest provider place id that still keeps the token inside the contract's 512-character bound. */
export const PLACE_ID_MAX_LENGTH = 200;

const Plaintext = z.strictObject({
  v: z.literal(1),
  pk: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  sku: z.enum(['AUTOCOMPLETE', 'GEOCODE']),
  pid: z.string().min(1).max(PLACE_ID_MAX_LENGTH),
  acct: z.uuid(),
  city: z.string().regex(/^[A-Z]{3}$/),
  exp: z.number().int().positive(),
});

function uuidFromBytes(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class PlaceRefSealer {
  constructor(
    private readonly cipher: FieldCipher,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seal(claims: PlaceRefClaims): string {
    if (claims.placeId.length === 0 || claims.placeId.length > PLACE_ID_MAX_LENGTH) throw new RangeError('place id length out of bounds');
    const tokenId = uuidv7();
    const exp = Math.floor(this.now().getTime() / 1000) + this.ttlSeconds;
    const plaintext = JSON.stringify({
      v: 1,
      pk: claims.providerKey,
      sku: claims.sku,
      pid: claims.placeId,
      acct: claims.accountId,
      city: claims.cityCode,
      exp,
    });
    const envelope = this.cipher.encrypt('place_refs', plaintext, { ...FIELD, rowId: tokenId });
    return `pr1.${Buffer.concat([Buffer.from(tokenId.replaceAll('-', ''), 'hex'), envelope]).toString('base64url')}`;
  }

  /**
   * Opens a token for `accountId`. Order: authenticity → account → expiry. The caller then compares `providerKey` with
   * the provider currently bound (a token from another provider is PLACE_REF_STALE).
   */
  open(token: string, accountId: string): PlaceRefClaims {
    const m = TOKEN.exec(token);
    if (!m?.[1]) throw new PlaceRefError('PLACE_REF_INVALID');
    const raw = Buffer.from(m[1], 'base64url');
    if (raw.length < 17) throw new PlaceRefError('PLACE_REF_INVALID');
    const tokenId = uuidFromBytes(raw.subarray(0, 16));
    let json: string;
    try {
      json = this.cipher.decryptString('place_refs', raw.subarray(16), { ...FIELD, rowId: tokenId });
    } catch (e) {
      if (e instanceof FieldDecryptionError) throw new PlaceRefError('PLACE_REF_INVALID');
      throw e;
    }
    let body: unknown;
    try {
      body = JSON.parse(json);
    } catch (e) {
      if (e instanceof SyntaxError) throw new PlaceRefError('PLACE_REF_INVALID');
      throw e;
    }
    const parsed = Plaintext.safeParse(body);
    if (!parsed.success) throw new PlaceRefError('PLACE_REF_INVALID');
    const p = parsed.data;
    if (p.acct !== accountId) throw new PlaceRefError('PLACE_REF_INVALID');
    if (p.exp * 1000 <= this.now().getTime()) throw new PlaceRefError('PLACE_REF_EXPIRED');
    return { providerKey: p.pk, sku: p.sku, placeId: p.pid, accountId: p.acct, cityCode: p.city };
  }
}
