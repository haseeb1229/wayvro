# 27 — Engineering Guardrails, Compatibility and Change Safety

## Purpose
Wayvro must remain changeable without turning every frontend redesign into a backend regression or every backend refactor into a mobile release emergency. This document makes compatibility, dead-code prevention, migrations, CI, feature flags, observability and rollback **explicit engineering policy**. Root `CLAUDE.md` is the persistent execution rulebook; this document explains the architecture intent behind those rules.

## 1. Change-risk principle
Every change is classified before implementation:
- **Presentation-only:** visual/layout/content/theme change; no public contract/domain/data changes expected.
- **Client behavior:** client state/flow changes within existing contract.
- **Contract change:** API/event/schema semantics change; requires consumer inventory and compatibility plan.
- **Domain change:** business invariant/state machine changes; requires domain tests and usually ADR.
- **Data change:** schema/backfill/retention change; requires migration and restore/rollback analysis.
- **Security/privacy/safety change:** separate threat/abuse/privacy review and feature gate.
- **Money/concurrency change:** transactional/idempotency/concurrency evidence mandatory.

A task may span multiple classes; the highest-risk class controls the gate.

## 2. Frontend must be replaceable
The UI layer may be redesigned substantially without changing backend/domain contracts unless the product requirement itself changes.

Required boundaries:
- visual components -> presentation/view-model layer -> typed client/contracts -> API/realtime boundary;
- no UI import of DB packages, server repositories, secrets, provider SDK internals or staff-only domain internals;
- no business-critical calculation duplicated in screens as authoritative truth;
- design tokens and reusable components isolate visual evolution;
- navigation/routes are not database primary keys or business-state sources;
- client caches are disposable replicas, not canonical state.

A redesign PR that changes API/database semantics must explicitly say why. “Needed for the new screen” is not enough without reviewing the product contract.

Because Wayvro is one public app with Rider and Driver/Partner modes, internal feature boundaries matter even more: a Rider redesign must not initialize or couple to driver KYC/background-location code, and Driver-mode work must not silently alter booking/payment behavior. Shared shell/design primitives are allowed; role-specific state and side effects stay isolated behind explicit interfaces.

## 3. Contract-first compatibility
Canonical API/event contracts live in a dedicated contract package and are runtime validated. OpenAPI/event schemas or equivalent generated artifacts are treated as build products with reviewable diffs.

Rules:
- additive changes are preferred;
- optional->required, type narrowing, enum removal/rename, semantic reinterpretation and field deletion are breaking unless proven otherwise;
- old released mobile clients may remain in the wild; backend rollout must account for supported client versions;
- breaking changes need versioning or a staged compatibility window;
- maintain explicit minimum-supported-app-version policy plus forced-update only where security/safety genuinely requires it;
- webhook/provider schema changes need signature verification, replay protection and tolerant-but-safe parsing;
- contract tests run against each active consumer surface.

## 4. Expand/migrate/contract for database evolution
For destructive or shape-changing changes:
1. **Expand:** add compatible schema/field/index/table; old and new code can coexist.
2. **Migrate/backfill:** resumable/idempotent transformation with metrics and correctness checks.
3. **Switch:** deploy code reading/writing the new representation; observe.
4. **Contract:** remove old representation only after no supported consumer/job depends on it and rollback implications are accepted.

Avoid schema locks/long transactions on hot tables. Benchmark large indexes/backfills. Migrations run in CI against clean and previous supported schema snapshots.

## 5. Dead-code and architecture hygiene
Accepted production paths must not accumulate abandoned experiments.

CI/tooling should cover, after Phase-0 ADR/tool selection:
- strict TypeScript and unused checks;
- ESLint/import boundaries;
- dead/unreferenced file/export/dependency scan (Knip or equivalent);
- dependency-cycle detection;
- duplicate dependency and package-policy checks;
- route/job/feature-flag inventory checks where feasible;
- generated-code drift detection.

Static output is evidence, not permission for mass deletion. Dynamic imports, framework conventions, native modules, jobs and generated routes must be accounted for before removal.

Temporary work must have one of:
- removed before phase acceptance; or
- a tracked requirement/issue, owner, reason, risk, target removal gate and feature flag if reachable.

No `old.ts`, `new-final.ts`, `component2.tsx` archaeology as a normal workflow.

## 6. Feature flags are controlled debt
Flags exist for staged rollout/kill-switch/experiments, not to avoid finishing code.
Every flag records:
- owner and purpose;
- default per environment;
- server/client enforcement location;
- safety/security implications;
- rollout cohort;
- observability metric;
- expiry/removal condition.

Stale flags are removed after rollout/rollback window; security or entitlement checks never rely solely on a client-side flag.

## 7. CI quality gates
Exact tools are selected in Phase 0/1 ADRs, but the pipeline must eventually enforce the applicable subset of:
1. formatting + strict typecheck;
2. lint + import/boundary rules;
3. dead-code/cycle/dependency policy;
4. secret scan + SAST/SCA/license checks;
5. unit/property tests;
6. API/event contract compatibility tests;
7. migration from clean and prior schema;
8. integration against real local Postgres/PostGIS/Redis/object store;
9. affected web/mobile/API build;
10. e2e journeys and negative states;
11. money/idempotency/concurrency tests where affected;
12. accessibility checks;
13. artifact/SBOM/signing/provenance gates where applicable.

No “green” build may silently exclude an app/service affected by the change.

## 8. Release and rollback discipline
- Develop behind bounded feature flags where partial exposure would be risky.
- Separate code deploy from risky feature activation where practical.
- Staged mobile releases/canaries are preferred over instantaneous full rollout.
- A unified-app release needs cross-mode regression and mode-segmented monitoring because one binary can affect riders and drivers simultaneously.
- Backend changes remain compatible with supported mobile versions during rollout.
- Every high-risk change has rollback or forward-fix strategy; database changes cannot pretend rollback is easy when it is not.
- Keep emergency kill switches for dispatch/pricing/payment/pooling/safety-sensitive functionality where architecture permits.

## 9. Error handling and resilience
No silent catches or “return success so UX continues.” External failures map to explicit domain/user/operations states. Retries are bounded and safe. Offline queues are idempotent and conflict-aware. State recovery after websocket loss/process restart is mandatory.

## 10. Security and privacy during change
Design changes must not accidentally expose data previously hidden. API responses use least-data principles; role checks remain server-side; analytics events are reviewed for PII/location leakage. Debug logging and temporary instrumentation are removed/redacted before accepted release.

## 11. Performance budgets
Set measurable budgets during Phase 0/1 for:
- mobile startup/bundle/native binary and memory on representative low-end devices;
- map/list rendering and animation smoothness;
- API P95/P99 latency by critical flow;
- location/dispatch freshness;
- websocket reconnect/recovery;
- database query/index performance;
- per-trip provider/infra cost.

A prettier UI that makes low-end devices unusable is a regression.

## 12. Definition of done for a safe change
A change is accepted only when scope, contracts, migrations, tests, operational impact, docs and evidence agree. “Works on my emulator” is never enough for a production mobility platform.
