---
id: WO-2026-077
title: Global Context Aggregation
goal: Create an endpoint that aggregates context from all projects into a unified view for the global agent.
context:
  - WO-2026-074 (project orchestrator)
  - Global agent needs visibility across all projects
  - Same context pattern as shift context, but project-level becomes one item in array
acceptance_criteria:
  - GET /global/context endpoint returns aggregated context
  - Each project includes summary (status, active shift, recent runs, escalations)
  - Escalation queue across all projects
  - Resource usage summary (VMs running, budget)
  - Sorted by priority/attention-needed
non_goals:
  - Global agent logic (separate WO)
  - UI for global view
stop_conditions:
  - If aggregation is too slow, add caching layer
priority: 2
tags:
  - autonomous
  - global-agent
  - infrastructure
estimate_hours: 3
status: ready
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-074
era: v2
---
## Architecture

```
GET /global/context

Response:
{
  projects: [
    {
      id: "pcc",
      name: "Project Control Center",
      status: "active",
      health: "healthy" | "stalled" | "failing" | "blocked",
      active_shift: { id, started_at, agent_id } | null,
      escalations: [ { id, type, summary } ],
      work_orders: { ready: 5, building: 1, blocked: 2 },
      recent_runs: [ { id, wo_id, status, outcome } ],
      last_activity: "2026-01-12T..."
    },
    ...
  ],
  escalation_queue: [
    { project_id, escalation_id, type, priority, waiting_since }
  ],
  resources: {
    vms_running: 2,
    vms_available: 3,
    budget_used_today: 12.50
  },
  assembled_at: "2026-01-12T..."
}
```

## Implementation

1. New endpoint in `server/index.ts`
2. Iterate all projects, call existing `getShiftContext()` for each
3. Summarize into lighter-weight format
4. Collect escalations into unified queue
5. Add resource tracking
