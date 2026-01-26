---
id: WO-2026-136
title: Local Runner Mode for VM-Hosted PCC
goal: Allow runs to execute directly on the PCC hosting VM instead of per-project VMs
context:
  - server/runner_agent.ts (run execution)
  - server/vm_manager.ts (per-project VM logic)
  - server/remote_exec.ts (SSH execution)
  - WO-2026-132 deploys PCC to VM
acceptance_criteria:
  - New setting to enable local runner mode per project or globally
  - When enabled, runs execute in local worktrees instead of SSH to separate VM
  - Existing per-project VM mode still works (backwards compatible)
  - Resource isolation via Docker containers when running locally
non_goals:
  - Removing per-project VM support entirely
  - Complex scheduling between local and remote
stop_conditions:
  - If local execution causes stability issues, keep per-project VMs as default
priority: 3
tags:
  - runner
  - vm
  - infrastructure
  - performance
estimate_hours: 4
status: ready
created_at: 2026-01-22
updated_at: 2026-01-26
depends_on:
  - WO-2026-132
era: v2
---
## Notes
- Main benefit: zero network sync latency
- Risk: resource contention if multiple runs execute simultaneously
- Mitigation: use Docker containers for isolation, limit concurrent runs
- Can be opt-in per project based on resource needs
