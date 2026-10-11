# ADR-040 — OIDC ID-token verification with `jose` (Google/Apple linking)

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.10 evidence** for the server-side verifier. Production use stays **EXTERNAL_GATED** (EG-06 Google, EG-07 Apple; activation P2.A2/P2.A3). The server-side verifier decision is in force since Phase 2 review and merge (PR #4, merge commit `7da51b0`, 2026-10-11) |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-040 (proposal) |
| Requirements | K15 (Google), K16 (Apple), S13 (link collisions, no merge), A05 (recovery with a linked identity) |
| Evidence | `apps/api/test/oidc.integration.test.ts`, `packages/db/test/oidc.integration.test.ts`, `apps/worker/test/account-jobs.integration.test.ts`; `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §P2.10 |

## Decision
ID tokens are verified on the server with **`jose` 6.2.12**. It was re-checked at install (ADR-030): latest stable, MIT, zero dependencies, not deprecated, published 2026-09-05.

The verifier (`apps/api/src/identity/oidc.service.ts`) accepts a token only if all of the following hold:
- RS256 signature by a key from the provider's JSON Web Key Set, supplied through the `OidcKeysPort` provider port;
- `iss` is the provider's issuer;
- `aud` is one of the configured client IDs (`OIDC_GOOGLE_AUDIENCES` / `OIDC_APPLE_AUDIENCES`);
- `exp`/`iat` within 60 s clock tolerance, and the token is at most 10 minutes old;
- the required claims are present;
- the `nonce` matches a server-issued single-use nonce: 5 minutes, bound to the installation for sign-in and to the session for linking and recovery. Google tokens carry the nonce itself; Apple tokens carry its SHA-256 hex. Only the SHA-256 of a nonce is stored, and every attempt spends it.

Algorithm confusion is excluded by the RS256 allowlist and by never accepting a key from the token itself.

**Product rules (auth design §7):**
- **No account creation by OIDC.** Sign-in works only for a LINKED (provider, subject); every failure gives the same generic 401 `WAYVRO_E_OIDC_NOT_LINKED`.
- **Phone step-up on unfamiliar installations.** An installation that never signed in with a phone OTP must step up on the phone first (`PHONE_STEP_UP`, founder Q-02).
- **Link and unlink** need a fresh phone step-up. A subject linked to another account gives a generic 409 `WAYVRO_E_OIDC_LINK_CONFLICT` and is audited as a Trust & Safety signal. Accounts are never merged.
- **No e-mail stored:** no e-mail, no name, no token. Only the provider and the opaque subject (data minimisation; the e-mail channel is deferred, Q-03). On account deletion, identities are unlinked and their subject erased.
- **Recovery with a linked identity:** a fresh token of the identity linked to the account that owns the lost number goes straight to a 72 h cooldown with notices ("cancel if this wasn't you"); the worker completes it.

**Gating:**
- Flags `platform.auth-oidc-google` and `platform.auth-oidc-apple` are ON only in the automated test environment, where the local issuer double (`LocalOidcIssuer`, test-only package, ADR-045) signs tokens with keys it publishes.
- They are OFF in local, staging and production.
- Without a bound key source or client IDs, every OIDC route answers 503.

## Not built (stated, not hidden)
- **Production key source:** an HTTPS fetch of the provider JWKS with bounded caching and refresh on an unknown `kid` arrives with activation P2.A2/P2.A3. The production composition binds no `oidcKeys`, so OIDC stays 503 there even if a flag were turned on.
- **Native SDKs:** Google Sign-In and `expo-apple-authentication` are not installed (activation).
- **Apple lifecycle:** Apple relay e-mail handling, server-to-server notifications and token revocation on deletion (P2.A3).
- **K15/K16** are not reported satisfied until real-provider integration tests pass (EG-06/EG-07).

## Alternatives
- `google-auth-library`: Google only.
- `openid-client`: a full RP flow is not needed for native ID tokens.
- Hand-rolled verification: rejected because of algorithm-confusion and parsing risk.

## Consequences / reversal
- The verifier is one internal module behind the `OidcKeysPort` provider port. Replacing `jose` changes `oidc.service.ts` only.
- Unlinking is always possible (the phone remains the credential). Turning the flags off removes the feature without data changes.
