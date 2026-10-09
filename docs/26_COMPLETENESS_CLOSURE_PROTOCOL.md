# 26 — Completeness Closure Protocol

The founder explicitly requires that even small features and project-side details are not silently missed. Since no finite list can prove future completeness, this protocol turns omissions into visible work.

## Before Phase 1 freeze
Every canonical requirement ID must have: disposition (`NOW`, `LATER`, `OUT_OF_SCOPE`, `EXTERNAL_DECISION`), product/domain owner, target phase, user surfaces, dependencies, state/data/API impacts, security/privacy/financial/safety implications, acceptance-test families and external blockers.

## Journey coverage
For every rider/driver/admin/support/company journey, cover: happy path, loading, empty, offline/slow, permission denied, auth/session expiry, duplicate/retry, cancellation, timeout, provider outage, background/killed app, stale data, fraud/abuse, support escalation, accessibility/localization, analytics/retention, rollback. Money/safety adds reconciliation, evidence and appeal.

## Discovery rule
Competitor research, field interviews, code review, legal advice, vendor docs, device testing or incidents may reveal a new item at any time. Before implementing it or assuming it is covered:
1. assign a new canonical ID or explicitly map it to an existing ID;
2. record source/reason and disposition;
3. resolve collisions/contradictions with current ADRs/state machines;
4. update affected tests/phase gates/cost and external blockers;
5. only then authorize implementation.

## Evidence hierarchy
Actual repo/worktree/runtime/DB state > reviewed exact-SHA remote CI/checkpoint > canonical current docs/ADRs > accepted reports > old prompts/history. Reports must never overwrite contrary evidence.

## Completion language
Use `implemented`, `tested`, `verified`, `externally approved`, `blocked` and `not tested` precisely. “Done” never means legal/vendor/human operations are complete merely because UI/backend code exists.
