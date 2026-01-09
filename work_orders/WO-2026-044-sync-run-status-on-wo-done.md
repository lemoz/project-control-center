---
id: WO-2026-044
title: Sync run status when work order marked done
goal: Automatically transition associated runs to `merged` when a work order is marked `done`, preventing stale "You Review" cards on the Kanban board.
context:
  - server/work_orders.ts (WO status updates)
  - server/db.ts (runs table)
  - app/projects/[id]/KanbanBoard.tsx (card placement logic)
acceptance_criteria:
  - When a WO status changes to `done`, all runs with status `you_review` for that WO are updated to `merged`.
  - Kanban board no longer shows cards in "You Review" column when their WO is already `done`.
  - If a WO is moved back from `done` to another status, runs remain unchanged (no reverse sync).
  - Add a one-time cleanup migration or API endpoint to fix existing orphaned runs.
non_goals:
  - Changing how runs are created or how the builder/reviewer loop works.
  - Syncing other run statuses (failed, canceled, merge_conflict).
stop_conditions:
  - If the sync causes data loss or overwrites meaningful run state, stop and ask.
priority: 2
tags:
  - bug
  - kanban
  - runner
estimate_hours: 2
status: you_review
created_at: 2026-01-09
updated_at: 2026-01-09
depends_on:
  - WO-2025-003
era: v1
---
## Notes

Bug discovered 2026-01-09: Work orders marked `done` still appeared in "You Review" column because their associated runs had `status = 'you_review'`. Manual fix applied:

```sql
UPDATE runs SET status = 'merged' WHERE status = 'you_review';
```

Root cause: No automatic sync between WO status and run status when WO transitions to done.
