/**
 * Test-only software WebAuthn authenticator (ES256, attestation "none") producing standard
 * Registration/AuthenticationResponseJSON for the API integration tests. Knobs let tests forge the failure cases the
 * server must reject: wrong origin, wrong RP ID, missing user verification, replayed challenge, counter regression.
 * Never part of any deployable artefact (test directory only).
 */
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

// ── minimal CBOR encoder (maps, arrays, byte/text strings, integers) ────────────────────────────────────────────
type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor>;
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();

export interface CeremonyOverrides {
  readonly origin?: string;
  readonly rpId?: string;
  readonly userVerified?: boolean;
  readonly counter?: number;
  /** Sign a different challenge than the one in the options (replay of an older challenge). */
  readonly challenge?: string;
}

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x ?? '', 'base64url');
    this.y = Buffer.from(jwk.y ?? '', 'base64url');
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  private authData(rpId: string, uv: boolean, counter: number, attested: boolean): Buffer {
    const flags = 0x01 | (uv ? 0x04 : 0) | (attested ? 0x40 : 0);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    const base = Buffer.concat([sha256(rpId), Buffer.from([flags]), c]);
    if (!attested) return base;
    const cose = cbor(
      new Map<number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, this.x],
        [-3, this.y],
      ]),
    );
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([base, Buffer.alloc(16), len, this.credentialId, cose]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  }

  /** RegistrationResponseJSON for creation options returned by the server. */
  register(options: Record<string, unknown>, o: CeremonyOverrides = {}): Record<string, unknown> {
    const challenge = o.challenge ?? String(options['challenge']);
    const clientDataJSON = this.clientData('webauthn.create', challenge, o.origin ?? this.origin);
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', this.authData(o.rpId ?? this.rpId, o.userVerified ?? true, 0, true)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** AuthenticationResponseJSON for request options returned by the server. */
  assert(options: Record<string, unknown>, o: CeremonyOverrides = {}): { id: string } & Record<string, unknown> {
    const challenge = o.challenge ?? String(options['challenge']);
    this.counter = o.counter ?? this.counter + 1;
    const clientDataJSON = this.clientData('webauthn.get', challenge, o.origin ?? this.origin);
    const authenticatorData = this.authData(o.rpId ?? this.rpId, o.userVerified ?? true, this.counter, false);
    const signer = createSign('sha256');
    signer.update(Buffer.concat([authenticatorData, sha256(clientDataJSON)]));
    const signature = signer.sign(this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) },
      clientExtensionResults: {},
    };
  }
}
