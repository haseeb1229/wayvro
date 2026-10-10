# CLAUDE.md — Permanent Repository Rules for Wayvro

**Product:** Wayvro (WAY-VRO)  
**Purpose:** Persistent engineering instructions for Claude Code across every phase. These rules stay active unless a later founder-approved ADR explicitly supersedes a technical detail. Current law/safety obligations, explicit founder decisions, audited repository truth, approved ADRs, and the current bounded phase scope outrank stale historical notes.

## 1. Read before changing anything
Before planning, editing, installing, migrating, committing, or pushing:
1. Inspect branch, HEAD, worktree, remotes, Git identity, CI status, current canonical docs, and active ADRs.
2. Read the current phase prompt and the exact files it references.
3. Inspect existing implementation/tests before proposing replacement code.
4. State assumptions and unresolved dependencies. Never invent credentials, integrations, approvals, test results, provider limits, legal conclusions, or production evidence.
5. Stay inside the founder-approved scope. No opportunistic framework upgrades, architecture rewrites, unrelated cleanup, or broad refactors.

## 2. Founder-locked public app topology — ONE Wayvro mobile app
Wayvro has **one public mobile application/store product** for both passengers and earning partners.

Within that single app:
- **Rider mode** is available to normal users for booking/travel services.
- A user may apply for a **Driver/Partner profile** inside the same account.
- After required verification/approval, the same user may switch into **Driver/Partner mode** and back to Rider mode.
- Future courier/delivery earning capabilities should extend the approved partner profile rather than create duplicate user accounts unless a later founder-approved ADR proves a different model is necessary.

Do **not** create separate Wayvro Rider and Wayvro Driver store apps. Do **not** duplicate accounts to simulate roles. The UI mode switch is never a security boundary: server-side authorization/capability state decides what the account may do.

Staff/admin functions remain a separate private web surface with server-enforced RBAC/ABAC. Public marketing, corporate/fleet and other web surfaces remain separately bounded. See `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`.

## 3. Unified-app role and mode integrity
- Model one identity account with separate role-scoped profiles/capabilities (for example rider profile, optional driver profile, vehicle/service eligibility, staff identity in a separate realm).
- Driver approval/suspension/expired documents can block earning without automatically blocking lawful Rider-mode use; severe account-wide safety/fraud/legal restrictions are separate and reason-coded.
- Never allow conflicting active states: an account cannot serve an incompatible driver job while participating in an active passenger trip, and cannot abandon an active driver obligation merely by switching UI mode.
- Mode switching, crash/restart, logout, device change, deep links and push notifications must restore authoritative server state deterministically.
- Rider history/ratings/payments and driver earnings/documents/ratings are authorization-isolated even though they belong to one account.
- Driver-only background services and sensitive permissions start only when justified and stop when no longer needed.

## 4. Frontend/backend decoupling and change safety
- Presentation depends on documented contracts, never database tables/server internals.
- Mobile/web clients must not import server-only/database implementation packages.
- API/event contracts are explicit, typed, runtime-validated, and versioned where necessary.
- A visual redesign should normally require **zero backend changes**. If a UI request genuinely requires a contract/domain change, call it out before editing and obtain bounded scope approval.
- Breaking contract changes require compatibility plan, affected-consumer inventory, contract tests, rollout order, and rollback/forward-fix strategy.
- Prefer additive evolution. Use **expand -> migrate/backfill -> switch -> contract** for destructive schema changes.
- Never silently rename/remove fields, enums, events, permissions, flags, routes, database columns, or error codes consumed elsewhere.
- Realtime delivery is not source of truth; clients recover authoritative state from backend APIs/state machines.
- Provider SDKs stay behind adapters/interfaces. UI/domain code must not directly depend on a specific maps, OTP, KYC, payment, storage, notification, analytics, or routing vendor unless an ADR explicitly justifies it.

## 5. Domain and data integrity
- Server is authoritative for authorization, KYC/compliance, pricing, assignment, trip lifecycle, promotions, money, refunds, payouts, fraud/safety state, and driver online eligibility.
- Use explicit state machines/invariants for critical transitions. Reject impossible transitions rather than repairing them in client UI.
- Authoritative money never uses binary floating-point. Use approved money representation and deterministic rounding.
- Critical state-changing endpoints/jobs/webhooks must be idempotent or document why not.
- Financial records follow append-only/double-entry principles where specified; never rewrite historical ledger truth to force reconciliation.
- Assignment/concurrency invariants require database-enforced protection and concurrency tests, not only process-local locks.
- Server time is authoritative for OTPs, quote expiry, leases, schedule cutoffs, promotions and financial periods.

## 6. Database and migration discipline
- Every schema change has a migration, compatibility assessment, data-impact note, rollback/forward strategy, and verification path.
- Never ship a destructive migration in the same rollout that first removes old-code compatibility unless a reviewed plan proves safety.
- Migrations must work from both clean DB and supported previous schema state.
- Large backfills are resumable, idempotent, observable and rate-limited where appropriate.
- Never wipe/reseed shared or production-like data to “fix” a migration.
- No manual production data edits without an approved runbook, least privilege, audit trail and backup/recovery plan.

## 7. No dead, fake, abandoned or AI-leftover production code
Do not leave:
- unused exports/imports/components/routes/endpoints/jobs/flags;
- duplicate `old/new/final-v2/tmp` implementations;
- commented-out implementation blocks;
- TODO/FIXME/HACK in an accepted production path without tracked owner/gate;
- mock provider success paths reachable in production;
- hardcoded test users, bypass OTPs, admin backdoors, fake KYC approvals, fake coordinates, fake payment success, or safety shortcuts;
- swallowed exceptions, empty catches, unconditional-success fallbacks, or disabled validation;
- broad `any`, `@ts-ignore`, lint-disable, test-skip or coverage exclusions used merely to make CI green.

Use strict compiler/lint/import-boundary checks plus the approved dead-code/dependency tools (Knip for unused files/exports/dependencies, dependency-cruiser for cycles and layer rules, eslint-plugin-boundaries for feature/client↔server isolation — ADR-027, `docs/phase0/PHASE0_ENGINEERING_GUARDRAILS.md`). Remove obsolete code when safely attributable; do not delete unfamiliar code only because a static tool flags it.

## 8. Testing and verification — no fake green
Run the layers relevant to the change: format/lint, strict typecheck, unit/property tests, contract tests, integration tests with real local infrastructure, API/mobile/web E2E, migration tests, security checks, concurrency tests, load/soak, and real-device tests where applicable.
- Never delete/weaken tests merely to pass.
- Mocked critical providers do not prove real integration.
- Report `NOT RUN`, `BLOCKED`, `SKIPPED`, and `FAILED` exactly.
- Verify happy path plus offline/retry/cancel/permission-denied/recovery/error states.
- Unified mobile releases require **cross-mode regression**: Rider-mode changes must not break Driver/Partner/KYC/background-location flows, and driver changes must not break booking/payment/rider safety.
- CI must build actual deployable artifacts/services, not only shared packages.

## 9. Mobile-specific rules for the unified Wayvro app
- One package/bundle identity and one public store listing; exact identifiers stay undecided until brand/company/domain/store clearance.
- Request sensitive permissions just in time. Rider-only users must not be prompted for driver background-location/KYC permissions without entering the relevant flow.
- Driver background location/navigation is high-risk: prove OS behavior, battery use, foreground-service/entitlement rules, revocation recovery, stale-location handling and privacy disclosure on representative devices.
- Do not trust device time, local role/KYC flags, client-calculated fare, or cached trip state.
- Persist minimum sensitive data using platform-secure storage where appropriate; define logout/account-deletion cleanup.
- Keep expensive driver-only initialization/background workers dormant outside justified Driver/Partner states; measure startup, memory, binary size and battery on low-end Android hardware.
- Deep links, notifications and restored navigation must be mode-aware but server-authorized.
- Driver ride offers never depend on push or Android full-screen intent: while online, the realtime socket/poll/recovery path inside the policy-compliant location foreground service is primary, push is only a wake/alert aid, and server offer state is authoritative (M26/ADR-033). `USE_FULL_SCREEN_INTENT` is not requested by default.
- Android/Gradle builds on the React Native/Expo path pin JDK 17 regardless of the JDK installed on the machine; release artefacts follow Q49 (Play AAB, evidence-based ABI set, 16 KB compliance; iOS through TestFlight to App Store production).

## 10. UI/UX and design-system rules
- Wayvro must look like an original professional mobility product, not an AI template or copied incumbent.
- Use design tokens, reusable primitives and well-defined view-state adapters so visual/brand/layout changes do not force domain/backend edits.
- Keep business rules out of visual components.
- Every meaningful screen handles loading, empty, error, offline, retry, permission-denied, partial-success, disabled and destructive-confirmation states where relevant.
- Treat English, Urdu and Roman-Urdu/local wording strategy, accessibility, low-end Android performance, dynamic text, touch targets, contrast, keyboard/screen-reader behavior and reduced motion as product requirements.
- No scattered hardcoded user-facing copy in business logic; use approved localization/content structure.

## 11. Security, privacy and safety
- No secrets, real OTPs, CNICs, selfies, licences, cards, private GPS trails, production dumps, cookies, refresh tokens or private keys in Git, prompts, fixtures, reports or screenshots.
- Logs/telemetry redact sensitive data; never log unnecessary precise location or identity/payment evidence.
- Staff/admin authorization is server-side, least-privilege and auditable.
- Sensitive features default OFF until their release gate passes.
- Never claim NADRA/police/insurance/payment/emergency integration without an actual authorized and tested integration.
- Safety/privacy/legal requirements outrank speed and feature-count targets.

## 12. Dependency and supply-chain discipline
- Add dependencies only after maintenance, licence, security, bundle/runtime cost and alternatives are understood.
- Avoid overlapping libraries for the same concern without ADR justification.
- Lock dependencies; review vulnerability/licence output; retain SBOM/build provenance where required.
- No major framework/runtime/database/provider upgrade inside an unrelated feature phase.
- Generated code must be reproducible from committed source/schema and not hand-edited unless the generator workflow explicitly permits it.

## 13. Observability, resilience and provider failure
- Structured errors use stable codes; UI gets actionable user-safe messages, not raw stack traces/provider messages.
- Timeouts, retries and backoff are bounded; no retry storms.
- Queue/job retries are idempotent and observable with poison/dead-letter handling where required.
- Define graceful degradation for maps, routing, realtime, push, OTP, KYC, payment and storage outages; never pretend degraded safety-critical flows succeeded.
- Add metrics/traces/logs for critical lifecycle transitions and segment unified-app telemetry by Rider/Driver mode without leaking PII.

## 14. Git/repository discipline
- Preserve founder ownership/attribution. No Claude/AI co-author trailers or tool branding.
- No force push, rebase, amend, `reset --hard`, `git clean`, signing/verification bypass, or history rewrite unless a separately reviewed exceptional recovery explicitly authorizes it.
- Preserve unrelated work. Stage reviewed paths only.
- Commit/push only when the current phase instruction and founder authorize it.
- Never claim a commit/CI result you did not verify; report exact SHA when applicable.

## 15. Docker/local-state safety
- Never run destructive prune/factory reset or delete unknown persistent volumes/data.
- Prefer named project resources and inspect ownership before cleanup.
- Local scripts should be repeatable without destroying unrelated projects.

## 16. Documentation and ADR discipline
- Any newly discovered feature, edge case, legal dependency, abuse mode or founder requirement enters the canonical requirements register before implementation; nothing remains only in chat/prose.
- Keep one current roadmap/authority model; mark older material historical instead of allowing conflicting instructions.
- Architecture/provider decisions record alternatives, evidence, consequences and reversal path.
- Update docs/tests/contracts in the same bounded change when behavior changes.
- Until superseded by founder-approved ADRs, the Phase 0 artefacts in `docs/phase0/` and the requirements register (`docs/requirements-register.json`, schema 5.1, 532 IDs after the Phase 2 planning closure added A15, with per-ID `phase0` dispositions generated from `docs/phase0/tools/`) are the requirement/phase authority. Edit generator sources, never generated files, and run `node docs/phase0/tools/phase0-coverage.js --check` and `node docs/phase0/tools/regen-manifest.js --check` before claiming documentation consistency.

## 17. Completion/report rule
A task is not “done” because code was written. Report:
- exact scope/files changed;
- requirement/ADR IDs satisfied;
- commands/tests run and exact outcomes;
- migrations/config/provider impacts;
- security/privacy/safety implications;
- compatibility/regression evidence;
- blockers/unverified assumptions;
- commit/CI evidence if authorized.

Never claim “production-ready”, “secure”, “verified”, “complete”, “zero bugs”, or “A-to-Z finished” without the corresponding evidence and release gates.
