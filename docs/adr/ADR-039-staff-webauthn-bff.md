# ADR-039 — Staff authentication: WebAuthn-native, BFF-held session, code-defined RBAC + ABAC

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.4 evidence** — pending founder/ChatGPT review of the full Phase 2 branch |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-039 (proposal; founder Q-01 approved WebAuthn-native now, SSO later) |
| Requirements | H01, H08, K01 (staff realm), K10, Q39 (viewer, verification visibility), Q42 (app part), W07 (shell, banner, idle lock) |
| Evidence | migration `0003_staff_realm`; `apps/api/src/staff/*`, `apps/api/src/auth/policy.ts`; `apps/web-ops/src/{bff,ui,app}`; tests `apps/api/test/staff.integration.test.ts` (13), `packages/db/test/staff-realm.integration.test.ts` (7), `tests/e2e-web/web-ops/staff.spec.ts` (7, Playwright + Chromium virtual authenticator + axe) |

## Decision
- **Library:** `@simplewebauthn/server` **14.0.3** (API) and `@simplewebauthn/browser` **14.0.0** (web-ops), MIT. 14.x over 13.3.x is security-driven: 13.3.x checks certificate revocation (fetching an attacker-supplied CRL URL into a process-wide cache) before validating the chain — the pattern of the 14.0.2 advisories GHSA-2g3p-m8c9-hhwh / GHSA-j3h4-m3m2-7p7j (not in the global advisory DB, so `npm audit` does not flag 13.x; maintainer confirmation for 13.x UNVERIFIED). Wayvro requests attestation `none`, so no CRL is fetched at all in our flows; 14.x is still the safer line. Node ≥ 22 requirement met (Node 24).
- **Ceremonies:** discoverable credentials (no identifier is asked for at sign-in ⇒ no staff enumeration), user verification REQUIRED at registration and assertion, exact RP ID + origin allowlist (`STAFF_WEBAUTHN_RP_ID` / `STAFF_WEBAUTHN_ORIGINS`; staging/production require https and a real RP ID at config load), server-side single-use challenges bound to purpose/session/invitation and consumed by CAS even when verification fails (the failure and the consumption are COMMITTED, then a generic 401), counter regression refused, assertion throttles per IP and per staff (Valkey; fail closed).
- **Session:** opaque `wvs_` token (separate token kind — consumer `wva_` tokens are refused on `/v1/admin/*` and vice versa), SHA-256 at rest, re-validated on every request (staff status, session, ACTIVE assignments read on database time ⇒ offboarding/role changes apply to the next request), idle lock 15 min (LOCKED ⇒ only unlock/logout/me), absolute 8 h, step-up window 5 min. **Deviation from the matrix's "5-minute BFF-refreshed access token":** a single session token held only in the BFF's `__Host-` HttpOnly Secure SameSite=Strict cookie and validated per request gives immediate revocation without a refresh flow; the token never reaches browser JavaScript (E2E-verified).
- **BFF:** web-ops proxies only the method+path pairs declared in `STAFF_ROUTES` (no open proxy), checks `Origin` on mutations, rewrites session-issuing responses into the cookie, clears it on logout/dead sessions.
- **RBAC + ABAC:** roles and role→permission maps are TypeScript constants (`apps/api/src/staff/roles.ts`); the database stores assignments and their city scope (junction with FK to `catalog.cities`). Maker-checker on privileged role grants (a DIFFERENT `STAFF_ADMIN`, never the grantee — service rule AND database CHECK); self-assignment refused and audited; single-operator ⇒ two-person steps block (EG-20). Every authenticated denial is audited (`STAFF_ACCESS_DENIED`, reason `MISSING_<PERMISSION>` / `STEP_UP_STALE` / `STAFF_NOT_ACTIVE`).
- **No emergency credential:** the bootstrap CLI (`pnpm --filter @wayvro/api staff:bootstrap -- --admin "Name <email>"`) creates 1–2 STAFF_ADMIN invitations (single-use, hash at rest, 24 h) and refuses while an active admin with an active authenticator exists — it is also the audited recovery path when every admin lost every key. Lost keys otherwise: re-enrolment invitation with maker-checker; enrolling the replacement revokes the old keys and their sessions; the last own key can never be removed.
- **Two-authenticator rule:** `/v1/admin/me` reports `twoAuthenticatorRuleSatisfied`; enforcement for privileged real-KYC operations is part of the `ops.kyc-real-evidence` gate (P2.6/P2.7, default OFF).
- **Break-glass:** ≤ 60 min (database CHECK), one active per staff member, reason-coded with a separate justification, alert events at start/end/expiry (high-severity structured log signals; SMS/paging EG-21), every permissioned action tagged (`BREAK_GLASS_ACTION`), review by someone else, due in 72 h.
- **Audit viewer:** the API role still cannot SELECT the audit tables (P2.1 property kept); AUDITOR reads through bounded `SECURITY DEFINER` functions (`audit.list_events`, max 100 rows, keyset; `audit.seal_status`), the sealer job records each verification in append-only `audit.seal_verifications`, and AUDITOR can request a verification job. External anchoring stays EG-05 and is displayed as such.
- **Free-text reasons stay out of the audit log:** `staff.access_reasons` (append-only) holds justification text linked to an audit event id; the reason-for-access modal is wired with the first PII view (P2.7).

## Deviations / notes
- Invitations need step-up but not maker-checker (an invited account has no role); maker-checker applies at the role grant, the step that confers privilege.
- `catalog.cities` is created in 0003 (not 0004) because role-assignment city scope needs a real FK.
- Staff network/device controls, staff SSO federation (P2.A6/EG-19) and production hosting stay external.

## Alternatives / reversal path
Hand-rolled WebAuthn (rejected, ADR-038 condition 2), TOTP (phishable), SSO-only (EG-19). Reversal: credentials are standard WebAuthn data; another library or an IdP can take them over; the BFF contract is unchanged.
