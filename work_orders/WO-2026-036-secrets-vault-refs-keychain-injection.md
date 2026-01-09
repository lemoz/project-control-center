---
id: WO-2026-036
title: Secrets vault refs + keychain injection
goal: Store secret values in host OS keychain and inject them into VM/container runs at runtime via env or temp mount, using refs from `.control.env.yml`.
context:
  - server/runner_agent.ts
  - server/db.ts
  - work_orders/WO-2026-034-environment-primitive-yaml-schema.md
  - work_orders/WO-2026-027-vm-based-project-isolation.md
acceptance_criteria:
  - Add secret metadata table with name, ref, scope, created_at, last_accessed, last_accessed_by, project_id (optional).
  - API to add/list/delete secret refs; values stored in OS keychain, never in repo/DB/logs.
  - Runner resolves refs from `.control.env.yml` and injects into VM/container as ephemeral env vars or temp file; scrubbed on teardown.
  - Missing secret fails run with clear error; no secret values appear in logs or diffs.
  - Each access emits a `secret_accessed` ledger event (WO-2026-035).
  - Agents can request new secrets via Work Orders; no auto-create.
non_goals:
  - Secrets stored in repo or inside VMs.
  - Remote secret managers or multi-user vaults.
stop_conditions:
  - If keychain integration is unavailable, stop and ask for a fallback (do not default to `.env`).
  - If injection into VM/container cannot be scrubbed safely, stop and ask.
priority: 3
tags:
  - security
  - secrets
  - runner
estimate_hours: 6
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-004
  - WO-2026-034
  - WO-2026-035
  - WO-2026-027
era: v2
---
## Notes
- 
