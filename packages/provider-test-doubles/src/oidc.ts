/**
 * Local OIDC issuer (ADR-040, ADR-045; TEST ONLY). Holds one RSA signing key per provider, publishes them as a JWKS
 * through `OidcKeysPort` and mints ID tokens with chosen claims so the server's verification (issuer, audience,
 * expiry, nonce, algorithm, signature) is exercised end to end without any network. A token from this issuer is never
 * evidence for the real Google/Apple gates (EG-06/EG-07).
 */
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { MOCK_PROVIDER, type MockBrand, type OidcKeysPort, type OidcProvider } from '@wayvro/provider-interfaces';

const ISSUERS: Readonly<Record<OidcProvider, string>> = { GOOGLE: 'https://accounts.google.com', APPLE: 'https://appleid.apple.com' };

interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: Readonly<Record<string, unknown>>;
}

export interface MintInput {
  readonly provider: OidcProvider;
  readonly subject: string;
  readonly audience: string;
  readonly nonce: string;
  /** Overrides for adversarial tests. */
  readonly issuer?: string;
  readonly issuedAtSeconds?: number;
  readonly expiresInSeconds?: number;
  /** Sign with a key the JWKS does not publish (forged token). */
  readonly unpublishedKey?: boolean;
}

export class LocalOidcIssuer implements OidcKeysPort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;

  private constructor(
    private readonly keys: Readonly<Record<OidcProvider, SigningKey>>,
    private readonly rogue: SigningKey,
  ) {}

  static async create(): Promise<LocalOidcIssuer> {
    const make = async (kid: string): Promise<SigningKey> => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
    };
    return new LocalOidcIssuer({ GOOGLE: await make('local-google-1'), APPLE: await make('local-apple-1') }, await make('local-google-1'));
  }

  keySet(provider: OidcProvider): Promise<{ readonly keys: ReadonlyArray<Readonly<Record<string, unknown>>> }> {
    return Promise.resolve({ keys: [this.keys[provider].jwk] });
  }

  /** A signed ID token; Apple's `nonce` claim carries the SHA-256 hex of the nonce, as Sign in with Apple does. */
  async mint(input: MintInput): Promise<string> {
    const key = input.unpublishedKey ? this.rogue : this.keys[input.provider];
    const now = input.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
    return new SignJWT({ nonce: input.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer(input.issuer ?? ISSUERS[input.provider])
      .setAudience(input.audience)
      .setSubject(input.subject)
      .setIssuedAt(now)
      .setExpirationTime(now + (input.expiresInSeconds ?? 600))
      .sign(key.privateKey);
  }
}
