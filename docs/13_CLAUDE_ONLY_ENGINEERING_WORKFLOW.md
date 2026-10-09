# 13 — Claude-Only Implementation, Founder + ChatGPT Review Workflow

**Founder decision 2026-10-09:** Claude Code is the only AI coding/reviewing agent. No separate AI reviewer required. Claude's internal review is NOT independent verification; ChatGPT will inspect actual GitHub state and reports when accessible, and qualified humans provide real launch safety/legal/security assessments.

## Responsibility
- **Founder (`haseeb1229`):** owner of IP, product decisions, repository, credentials, money, launch and final authority. All commits use founder-authorized Git config; no AI coauthor attribution or signatures.
- **Claude Code / Opus:** inspect current repo, produce bounded plan, implement, run tests, challenge own assumptions, review changed files, fix, prepare evidence-rich report. It must distinguish command output from assumptions; self-audit never described as independent.
- **ChatGPT:** receives Claude report + repository URL/branch/commit SHA, uses GitHub connector when authorized and accessible to inspect exact diff, changed files, PRs and CI; flags inconsistencies/gaps and creates the next scoped Claude prompt. If GitHub is not accessible, says so and asks for diff/evidence, never fabricates verification. Does not automatically approve risky changes from Claude's summary alone.
- **Outside qualified humans:** transport/legal, KYC/insurance, data protection and security testers, accountant/PSP, safety/field operations, before actual real rides.

## Persistent `CLAUDE.md` rulebook
Once the repository is initialized, root `CLAUDE.md` is a permanent execution guardrail and must be read before each scoped change. Claude may propose edits to it only when the current task genuinely changes engineering policy; it must not weaken/remove safeguards to make work easier. Current founder-approved phase scope, law/safety, approved ADRs and audited repository truth remain higher authority.

The rulebook explicitly covers frontend/backend decoupling, API/schema compatibility, expand/migrate/contract database changes, dead/temporary code, CI/test honesty, mobile permissions, dependency hygiene, security/privacy, feature flags, observability, Git/Docker safety and evidence-rich completion reports.

## Phase/micro-phase execution
1. Founder gives Claude the complete **current approved docs** and one prompt with precise scope; Claude checks actual branch, status, HEAD, read-only files and previous report first.
2. For Phase 0 and each material design change, Claude provides **PLAN ONLY**. Founder gives report to ChatGPT for risk/gap review; founder approves or returns correction requests before any coding.
3. Claude implements **only** approved bounded scope in a feature branch; produces tests plus read-only self-audit of diff and targeted negative/security/concurrency scenarios; fixes blockers. Never claims self-review is independent.
4. Before committing/pushing any scoped task, Claude outputs summary, tests, unresolved findings, diff stats, migrations, risky files, and exact commands. Founder authorizes scope and Git write. Claude then commits/pushes without rewriting history or AI attribution.
5. Claude produces phase report with `branch`, `base SHA`, `final SHA`, changed paths, file inventory, commands+actual output, CI, dependencies, test failures/skips, security, cost, incidents, decisions and next gate. No invented results.
6. Founder forwards report to ChatGPT. ChatGPT independently inspects code/diff/CI through connected GitHub when available; otherwise reports evidence missing and requests actual artifacts. If blockers arise, Claude receives corrective prompt and new SHA is reverified; only then proceed.
7. Major milestones and any real ride/payment/biometric exposure still need appropriately qualified **independent human** review; AI-only process never waives it.

## Permanent safeguards adopted from Minhaj
- No unauthorized force push, amend, rebase, `git reset --hard`, `git clean`, hook/branch protection bypass, main-branch mutation or mass file deletion.
- No destructive Docker pruning/volumes/data reset; use only approved targeted commands. Check disk resource consumption after heavy Docker tasks.
- No credentials, private OTPs, CNIC/selfies, real ride GPS trails or production dumps in Git, PRs, logs, pasted reports or AI prompts. Local configuration via `.env` excluded from VCS; use secrets manager in deployed environments.
- Preserve canonical docs and reviewed migrations. Schema changes need migration+rollback/compensating plan, safeguards and test proof. No opportunistic unrelated refactors or version upgrades.
- No billing/paid provider provisioning or external account creation without founder authorization. Use local mocks/synthetic data in planning and early build.
- Privacy and user safety take priority over schedule. Sensitive feature flags default OFF until approval.
- Clean report must say **NOT RUN** for any skipped test. Never assert 100% perfect, flawless or production ready based solely on passing local tests.
- GitHub repo reality plus verified CI outranks unsupported past claims; explicit founder decisions outrank stale proposals, legal/safety requirements outrank both.

## Non-negotiable release gates
- No driver onboarding or CNIC/face capture on public users until vault, consent, access and retention verified.
- No real ride until applicable insurance/permit/driver verification, emergency and human support work in reality.
- No public payment/held funds without approved partner arrangements, reconciliation and legal sign-off.
- Periodic holistic architecture/security/financial and physical safety review before closed live pilot, public launch and each major vertical rollout, even without a second AI coding agent.


## Inherited engineering controls from the proven Minhaj workflow
- Backend/API/schema completion is **not** user-facing product completion. Every phase verifies actual rider/driver/staff UX and professional microstates.
- The public mobile product is one Wayvro app with Rider and Driver/Partner modes. Claude must preserve role/capability isolation, just-in-time driver permissions and cross-mode regression; it must not split the product into separate store apps without an explicit founder decision.
- Every plausible capability encountered is classified NOW/LATER/OUT-OF-SCOPE/EXTERNAL-DECISION; do not leave silent assumptions.
- Keep presentation replaceable and boundaries explicit; product scope, domain model, security, migration and architecture decisions remain separate concerns.
- Before any work: inspect branch, HEAD, worktree, remote, Git identity, CI and current canonical docs. Actual repository state outranks stale reports/prompts.
- Do not reopen accepted green phases without regression evidence. Do not perform opportunistic unrelated refactors/version upgrades.
- Never `docker volume prune`, `docker system prune --volumes`, factory reset, or delete unknown persistent state.
- Never migrate Claude/auth/session JSON, OAuth refresh tokens, cookies or plaintext API keys between machines/repositories.
- Commit/push only the authorized bounded scope, with no AI co-author/tool attribution trailers. Report exact SHA and evidence.

## Additional inherited repo discipline
- Preserve unrelated work and use explicit reviewed-path staging; do not stage the whole worktree by habit.
- Normal non-force push only after founder authorization; record exact remote SHA and wait for CI on that SHA before next gate.
- `main`/protected branches and unrelated PRs are not modified unless the current phase explicitly authorizes them.
- After Docker-heavy work, inspect resource usage; delete only clearly identified disposable resources. Never prune unknown/persistent volumes or factory reset Docker as cleanup.
- No fake-green proofs: skipped tests, mocked-away critical integration, unsupported screenshots or report prose cannot substitute for required runtime/SQL/concurrency/recovery/device/security evidence.
