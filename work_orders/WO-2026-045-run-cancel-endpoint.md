---
id: WO-2026-045
title: Run cancel endpoint
goal: Add API endpoint to cancel in-progress runs, killing the runner worker process and updating run status.
context:
  - server/index.ts (API routes)
  - server/runner_worker.ts (spawned process)
  - server/db.ts (run status updates)
  - server/runner_agent.ts (run execution)
acceptance_criteria:
  - POST /runs/:id/cancel endpoint cancels an in-progress run.
  - Endpoint kills the runner_worker process for that run (SIGTERM, then SIGKILL if needed).
  - Run status is updated to "canceled" in the database.
  - Endpoint returns 200 with updated run status on success.
  - Endpoint returns 404 if run not found, 400 if run is not in a cancelable state (already finished/canceled).
  - Kanban board and run detail page reflect canceled status correctly.
non_goals:
  - Graceful mid-iteration checkpointing (just kill and mark canceled).
  - Undo/resume canceled runs.
  - Bulk cancel operations.
stop_conditions:
  - If process management across platforms is complex, simplify to Unix-only first.
priority: 2
tags:
  - runner
  - api
  - ux
estimate_hours: 2
status: ready
created_at: 2026-01-09
updated_at: 2026-01-09
depends_on: []
era: v1
---
## Notes

Discovered 2026-01-09: No way to cancel runs via API. Had to manually:
1. Find runner_worker PIDs with `ps aux | grep <run_id>`
2. Kill processes with `kill <pid>`
3. Update database with `sqlite3 ... UPDATE runs SET status = 'canceled'`

This should be a single API call.
