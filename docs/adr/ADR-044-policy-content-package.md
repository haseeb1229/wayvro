# ADR-044 — Policy content as a versioned, immutable workspace package

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.2 evidence** — in force since Phase 2 review and merge (PR #4, merge commit `7da51b0`, 2026-10-11) |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-044 (proposal) |
| Requirements | A04, R09, W05, K14 (consent infrastructure), A15 (mechanism; explanation page) |
| Evidence | `packages/legal-content` (+ `src/index.test.ts`), `packages/db/migrations/0002_policy_consent_age.sql` (+ `packages/db/test/policy-consent-age.integration.test.ts`), `apps/api/src/legal/*` (+ `apps/api/test/legal.integration.test.ts`, `apps/api/test/policy-registry.test.ts`), `apps/web-public/src/app/legal/**` (+ `tests/e2e-web/web-public/legal.spec.ts`) |

## Decision
- **`@wayvro/legal-content`** is a data-only package: a catalogue of policies (`TERMS`, `PRIVACY`, `DRIVER_PARTNER_AGREEMENT`, `BIOMETRIC_KYC_NOTICE`, `COMMUNITY_GUIDELINES`, `CANCELLATION_REFUND`, `AGE_ELIGIBILITY`), each with immutable versions (status, effective date, material-change flag, approval reference, change summary) and a structured body per locale (`en`, `ur`; Roman-Urdu readers are served English until counsel/product decide). Bodies are structured data (title + sections), not Markdown, so no renderer dependency is needed.
- **Immutability is enforced three times:** (1) `published-hashes.ts` locks the SHA-256 of every published `(key, version, locale)` — an in-place edit fails the unit test and module load; (2) the API registers the catalogue into `legal.policy_documents` at boot (insert-only grant; UPDATE/DELETE/TRUNCATE rejected by trigger even for the owner) and **refuses to boot** when a registered row differs; (3) `identity.consent_records` references `(policy_key, version, locale, content_sha256)` by composite foreign key, so a consent to unknown wording cannot exist.
- **Placeholders are honest outlines** marked `PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval` in both locales; pages are `noindex`. `WAYVRO_ENV=production` refuses to boot with any placeholder text or a placeholder age policy (`productionPolicyProblems`); local/test/staging may run them (CL-P2-09).
- **Age-policy values are not content:** thresholds and the declaration mode live in `legal.age_eligibility_policies` (data, maker-checker entry in P2.5); only the user-facing explanation (`AGE_ELIGIBILITY`) is content. The seeded placeholder has **no threshold** (A15/EG-23) and mode `AFFIRM_MINIMUM_AGE`; a DOB is accepted only when a version's mode is `DATE_OF_BIRTH_REQUIRED` (encrypted, key class `identity_dates`, never echoed).
- Deviation from the data model: `legal.policy_documents` has no `RETIRED` status — supersession is "a newer version is effective" (rows never change).

## Consequences
- Publishing new wording = append a version + its hash; counsel-approved texts (P2.A7) arrive the same way.
- The API is the writer of the registry (insert-only). A compromised API could register a new version but could not alter or remove a published one.
- A build that lacks a version registered by a newer build logs a warning and keeps serving its own catalogue (rollback-safe).

## Alternatives / reversal path
Markdown + generated manifest (proposal) — rejected: needs a renderer and a generator drift check for no gain. CMS (W01) — later; the package becomes a CMS export target. Seeding via migrations — rejected: couples content releases to schema releases.

## Web E2E tooling (adopted in the same micro-phase, CON-P2-03)
`@playwright/test` **1.62.1** (Apache-2.0; 2026-07-30, the latest patch of a line with a follow-up patch — 1.63.0 had none and 1.64.0 was 4 days old; GHSA-7mvr-c777-76hp fixed since 1.55.1) and `@axe-core/playwright` **4.13.0** (MPL-2.0, dev-only). Chromium revision 1234. New CI job `e2e-web` runs against production builds. Reversal: drop the job; nothing in production depends on it.
