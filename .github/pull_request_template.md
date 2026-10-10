## Scope

<!-- Phase / micro-phase and the founder-approved scope this change belongs to. -->

## Change class (docs/27 §1) — tick all that apply; the highest-risk class sets the gate

- [ ] Presentation-only - [ ] Client behaviour - [ ] Contract change - [ ] Domain change
- [ ] Data/migration - [ ] Security/privacy/safety - [ ] Money/concurrency

## Requirement IDs and ADRs

<!-- e.g. I03, Q49, ADR-036. New requirements go into the register before implementation (CLAUDE.md §16). -->

## Evidence

| Check                                                                        | Command                                               | Result (PASSED / FAILED / SKIPPED + reason / NOT RUN / BLOCKED) |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Format, lint, typecheck, boundaries, knip, syncpack, flags, unit tests, docs | `pnpm check`                                          |                                                                 |
| Integration (real PostGIS/Valkey)                                            | `pnpm test:integration`                               |                                                                 |
| Boot smoke                                                                   | `node scripts/boot-smoke.mjs`                         |                                                                 |
| Android release gates (if mobile changed)                                    | `pnpm --filter @wayvro/wayvro-mobile android:release` |                                                                 |
| Cross-mode regression (Rider ↔ Driver)                                       |                                                       |                                                                 |

## Compatibility / migration / rollback

<!-- Contract consumers, N-1 mobile impact, expand→migrate→switch→contract step, rollback or forward-fix. -->

## Security, privacy, safety

<!-- New permissions, PII, secrets, provider bindings, sensitive flags (default OFF). -->

## NOT RUN / known gaps

<!-- List anything not executed and why. No fake green. -->
