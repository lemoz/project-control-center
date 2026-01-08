---
id: WO-2026-040
title: Remote exec + repo sync safety (secrets/env/guardrails)
goal: Add SSH remote execution and repo sync with guardrails (safe paths, secrets exclusion, env handling).
context:
  - work_orders/WO-2026-027-vm-based-project-isolation.md (sync + artifacts)
  - work_orders/WO-2026-039-vm-provisioning-lifecycle-gcp-ssh-ip-refresh.md (VM access)
  - docs/work_orders.md (ready contract)
  - server/remote_exec.ts (new implementation)
  - server/runner_agent.ts (consumer)
  - server/index.ts (API surface)
acceptance_criteria:
  - remote_exec/remoteUpload/remoteDownload support running commands over SSH with exit codes, stdout/stderr, and timeouts.
  - Repo sync uses a fixed VM root (e.g., /home/project/repo), validates paths, and refuses traversal or absolute-path deletes.
  - Sync excludes secrets and local-only files (.env*, .control-secrets*, .git, node_modules) by default.
  - Env injection is safe (no shell interpolation) and command failures propagate back to caller.
  - All remote operations emit structured errors and do not silently ignore non-zero exit codes.
non_goals:
  - VM provisioning or lifecycle (WO-2026-039).
  - Runner orchestration and artifact egress (WO-2026-041).
  - Container support (WO-2026-028).
stop_conditions:
  - If safe path validation cannot be guaranteed, stop and ask.
  - If secrets exclusion requirements are ambiguous, stop and ask.
  - If rsync/scp is unavailable on the VM image, stop and report.
priority: 2
tags:
  - runner
  - infra
  - vm
  - security
estimate_hours: 3
status: ready
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2026-039
era: v1
---
## Notes
- 
