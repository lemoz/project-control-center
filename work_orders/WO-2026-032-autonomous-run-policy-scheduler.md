---
id: WO-2026-032
title: Autonomous run policy + scheduler
goal: Enable safe autopilot runs of Ready work orders with policy guardrails and visibility.
context:
  - server/runner_agent.ts (run queue)
  - server/db.ts (runs/policies)
  - app/projects/[id]/page.tsx (project UI)
  - WO-2026-020 (worktree isolation)
  - WO-2026-028 (tech tree)
  - WO-2026-029 (constitution)
acceptance_criteria:
  - "Add per-project autopilot policy: enabled, max_concurrency, allowed_tags, min_priority, time_window, stop_on_failures."
  - Scheduler selects eligible Ready WOs with dependencies satisfied and enqueues runs; logs decisions.
  - Autopilot refuses to run if worktree isolation is disabled or repo is dirty.
  - UI toggle to enable/disable autopilot and show next candidate plus recent autopilot actions.
  - Runs launched by autopilot are labeled and can be paused or cancelled.
non_goals:
  - Automatic work order generation.
  - Cross-project scheduling.
  - Remote execution.
stop_conditions:
  - If safety checks are insufficient, default autopilot to disabled and stop.
priority: 4
tags:
  - runner
  - autonomous
  - policy
  - scheduling
estimate_hours: 8
status: backlog
created_at: 2026-01-07
updated_at: 2026-01-09
depends_on:
  - WO-2025-004
  - WO-2026-020
  - WO-2026-028
  - WO-2026-031
era: v2
---
## Notes
- 
