# Founder — Send this checklist with Claude's actual phase output to ChatGPT

Copy Claude's FULL report (redact all secrets and PII) and provide: GitHub repository URL (if accessible), branch, base and final commit SHA, whether push happened, phase/subtask ID, changed files list, commands/test result excerpts, CI run links/status, migration files and test evidence, blockers/known skips and exact requested next step. If repo is private, share connector access when prompted; a report is not proof of a successful run.

ChatGPT should compare current approved docs, actual GitHub commit/diff/CI when connected, stop on blockers, suggest targeted Claude fixes, and only then draft the next bounded phase prompt. The founder approves Git write/deploy/provisioning and accepts business/legal decisions. External independent human security/legal/safety checks still apply before real rides.


## Phase 0 extra handoff
Include Claude's `PHASE0_GAP_REPORT`, requirement coverage table, competitor matrix, ADR backlog, unified-app role model, cost/provider matrix and launch blockers. Do not summarize away failures. ChatGPT will compare claims to actual GitHub SHA/files/CI where access is available before the next prompt.
