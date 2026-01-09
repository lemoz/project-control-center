---
id: WO-2026-030
title: Outcome + decision signal capture
goal: Capture outcome and decision signals from runs and work orders to feed constitution and planning.
context:
  - server/db.ts (schema)
  - app/runs/[id]/RunDetails.tsx
  - app/projects/[id]/work-orders/[workOrderId]/WorkOrderDetails.tsx
  - server/runner_agent.ts (run results)
acceptance_criteria:
  - "Add a signals table with fields: project_id, work_order_id, run_id, type, summary, tags, source, created_at."
  - API endpoints to create/list signals by project or work order.
  - UI provides an Add outcome note action on Run details and Work Order details.
  - Optional prompt to add a note when a run fails or when a Work Order is marked done (can skip).
  - Recent signals are visible from the project overview or constitution panel.
non_goals:
  - Automatic extraction of preferences or outcomes.
  - Mandatory notes.
stop_conditions:
  - If status-change hooks are too invasive, keep manual note entry only.
priority: 3
tags:
  - planning
  - learning
  - ux
  - data
estimate_hours: 4
status: backlog
created_at: 2026-01-07
updated_at: 2026-01-09
depends_on:
  - WO-2025-003
  - WO-2025-004
  - WO-2026-029
era: v1
---
## Notes
- 
