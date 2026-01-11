---
id: WO-2026-032
title: Autonomous run policy + scheduler
goal: Enable safe autopilot runs of Ready work orders with policy guardrails and visibility.
context:
  - server/runner_agent.ts (run queue, runRun)
  - server/db.ts (runs table, projects table)
  - server/work_orders.ts (dependency checking at line 606)
  - server/index.ts (POST /repos/:id/work-orders/:woId/runs endpoint)
  - app/projects/[id]/page.tsx (project UI)
  - "Constitution injection already working (1793 chars injected in recent runs)"
acceptance_criteria:
  - Add autopilot_policies table with per-project settings (enabled, max_concurrent_runs, allowed_tags, min_priority, stop_on_failure_count, schedule_cron)
  - Add triggered_by column to runs table ('manual' | 'autopilot')
  - Scheduler loop (setInterval) checks for eligible WOs every 60s when enabled
  - Eligible = status:ready + all depends_on are done + matches policy filters
  - Safety checks before run: VM provisioned, no active run for same WO
  - API: GET/PUT /projects/:id/autopilot (policy), GET /projects/:id/autopilot/candidates
  - UI: Toggle switch on project page, shows next candidate WO, recent autopilot activity
  - Autopilot runs are labeled in UI and logs
non_goals:
  - Automatic work order generation
  - Cross-project scheduling
  - Constitution learning/synthesis (use existing injection)
  - Parallel runs on same project (sequential only for MVP)
stop_conditions:
  - If safety checks are insufficient, default autopilot to disabled
  - If no VM provisioned for project, skip that project
priority: 1
tags:
  - runner
  - autonomous
  - policy
  - scheduling
estimate_hours: 6
status: backlog
created_at: 2026-01-07
updated_at: 2026-01-11
depends_on:
  - WO-2025-004
  - WO-2026-020
  - WO-2026-028
era: v2
---

## Implementation Plan

### Phase 1: Database Schema

```sql
CREATE TABLE IF NOT EXISTS autopilot_policies (
  project_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
  allowed_tags TEXT DEFAULT NULL,  -- JSON array or null for any
  min_priority INTEGER DEFAULT NULL,  -- null = any priority
  stop_on_failure_count INTEGER NOT NULL DEFAULT 3,
  schedule_cron TEXT DEFAULT NULL,  -- null = continuous, or cron pattern
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Add to runs table
ALTER TABLE runs ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'manual';
```

### Phase 2: Scheduler Logic

In `server/runner_agent.ts` or new `server/autopilot.ts`:

```typescript
async function runAutopilotCycle() {
  const policies = getEnabledAutopilotPolicies();

  for (const policy of policies) {
    // Safety checks
    if (!isProjectVmReady(policy.project_id)) continue;
    if (hasActiveRun(policy.project_id)) continue;
    if (recentFailureCount(policy.project_id) >= policy.stop_on_failure_count) continue;

    // Find eligible WO
    const candidate = findEligibleWorkOrder(policy);
    if (!candidate) continue;

    // Start run
    await startRun({
      projectId: policy.project_id,
      workOrderId: candidate.id,
      triggeredBy: 'autopilot',
    });

    logAutopilotAction(policy.project_id, 'started', candidate.id);
  }
}

function findEligibleWorkOrder(policy: AutopilotPolicy): WorkOrder | null {
  const readyWOs = getReadyWorkOrders(policy.project_id);

  for (const wo of readyWOs) {
    // Check dependencies satisfied
    if (!allDependenciesDone(wo)) continue;

    // Check tag filter
    if (policy.allowed_tags && !matchesTags(wo, policy.allowed_tags)) continue;

    // Check priority filter
    if (policy.min_priority && wo.priority > policy.min_priority) continue;

    return wo;  // First eligible wins (sorted by priority)
  }

  return null;
}

// Start scheduler
setInterval(runAutopilotCycle, 60_000);
```

### Phase 3: API Endpoints

```typescript
// GET /projects/:id/autopilot
app.get('/projects/:id/autopilot', (req, res) => {
  const policy = getAutopilotPolicy(req.params.id);
  const candidates = findEligibleWorkOrders(policy);
  const recentActions = getRecentAutopilotActions(req.params.id, 10);
  res.json({ policy, candidates, recentActions });
});

// PUT /projects/:id/autopilot
app.put('/projects/:id/autopilot', (req, res) => {
  const updated = updateAutopilotPolicy(req.params.id, req.body);
  res.json(updated);
});
```

### Phase 4: UI

On project page, add Autopilot panel:
- Toggle switch (enabled/disabled)
- Status indicator (running/idle/paused-on-failures)
- Next candidate WO (if any)
- Recent autopilot activity log (last 5 actions)
- Link to policy settings

## Safety Checklist

- [ ] Autopilot defaults to disabled
- [ ] Requires VM to be provisioned
- [ ] Stops after N consecutive failures
- [ ] Only runs one WO at a time per project
- [ ] Labels all autopilot runs clearly
- [ ] Can be disabled at any time (takes effect immediately)

## Files to Modify

1. `server/db.ts` - Add autopilot_policies table, alter runs table
2. `server/autopilot.ts` (new) - Scheduler logic
3. `server/index.ts` - API endpoints
4. `app/projects/[id]/page.tsx` - UI panel
