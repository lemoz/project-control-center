---
id: WO-2026-041
title: Runner integration + artifact egress + remote test setup
goal: Route runner through VM when enabled, ensure remote test setup, and sync artifacts back to host run storage.
context:
  - work_orders/WO-2026-027-vm-based-project-isolation.md (fallback + artifacts)
  - work_orders/WO-2026-038-vm-isolation-scaffolding-db-api-ui.md (mode + status)
  - work_orders/WO-2026-040-remote-exec-repo-sync-safety-secrets-env-guardrails.md (remote exec)
  - docs/work_orders.md (ready contract)
  - server/runner_agent.ts (execution path)
  - server/db.ts (run metadata)
  - .system/runs/ (artifact storage)
acceptance_criteria:
  - Runner checks project isolation mode; uses remote_exec when vm or vm+container and VM is running, else falls back per WO-2026-027 with recorded reason.
  - Remote runs install dependencies (npm ci) and run tests; exit codes update run status consistently.
  - Artifacts (diff.patch, run.log, test outputs, reviewer results) are copied back into `.system/runs/{id}/` and linked to the run record.
  - Remote run workspace is created per run and cleaned up afterward.
  - Known stray artifacts (e2e/.tmp) are not committed or synced back to repo.
non_goals:
  - Provisioning or VM lifecycle (WO-2026-039).
  - Remote exec implementation (WO-2026-040).
  - Container-per-run (WO-2026-028).
  - Cost metering or scheduler (WO-2026-032/037).
stop_conditions:
  - If artifact egress cannot be made reliable, stop and ask.
  - If fallback vs hard-fail behavior is ambiguous, stop and ask.
  - If remote test setup requires interactive input, stop and report.
priority: 2
tags:
  - runner
  - vm
  - tests
estimate_hours: 4
status: ready
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2026-038
  - WO-2026-039
  - WO-2026-040
era: v1
---
## Notes
- 
