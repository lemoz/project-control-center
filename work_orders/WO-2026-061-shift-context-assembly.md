---
id: WO-2026-061
title: Shift Context Assembly
goal: Create an API/script that gathers all context an agent needs to take an informed shift on a project.
context:
  - docs/agent_shift_protocol.md (WO-2026-060)
  - .control.yml (goals, success_criteria, success_metrics)
  - server/work_orders.ts (WO state, dependencies)
  - server/db.ts (runs, projects)
  - server/constitution.ts (learnings, preferences)
acceptance_criteria:
  - Endpoint or script returns complete shift context as structured JSON
  - Includes project goals (success_criteria, success_metrics, current vs target)
  - Includes WO state (ready, backlog, done counts + details of actionable items)
  - Includes recent run history (last N runs, success/fail, patterns)
  - Includes active constitution content
  - Includes last handoff notes (if any)
  - Includes current blockers/issues
  - Includes git state (branch, working tree status, uncommitted changes)
  - Includes active runs (to avoid conflicts)
  - Includes time since last human interaction
  - Includes environment status (VM provisioned/status, env vars available, runner readiness)
  - Output is LLM-friendly (can be injected into prompt)
non_goals:
  - Decision making (that's the agent's job)
  - UI for viewing context
  - Historical analysis beyond recent runs
stop_conditions:
  - If context becomes too large for prompt injection, add summarization
priority: 1
tags:
  - autonomous
  - api
  - context
estimate_hours: 3
status: you_review
created_at: 2026-01-11
updated_at: 2026-01-12
depends_on:
  - WO-2026-060
era: v2
---
## Implementation

### Endpoint

```
GET /projects/:id/shift-context
```

### Response Schema

```typescript
interface ShiftContext {
  // Project identity
  project: {
    id: string;
    name: string;
    path: string;
    type: "prototype" | "long_term";
    stage: string;
    status: string;
  };

  // Goals - the north star
  goals: {
    success_criteria: string;  // From .control.yml
    success_metrics: Array<{
      name: string;
      target: string | number;
      current: string | number | null;
    }>;
  };

  // Work order state
  work_orders: {
    summary: {
      ready: number;
      backlog: number;
      done: number;
      in_progress: number;
    };
    ready: WorkOrderSummary[];      // Actionable now
    backlog: WorkOrderSummary[];    // Could be promoted
    recent_done: WorkOrderSummary[]; // Last 5 completed
    blocked: WorkOrderSummary[];     // Has unmet dependencies
  };

  // Execution history
  recent_runs: Array<{
    id: string;
    work_order_id: string;
    status: string;
    error: string | null;
    created_at: string;
  }>;

  // Learnings
  constitution: {
    content: string;
    sections: string[];
  } | null;

  // Continuity
  last_handoff: {
    created_at: string;
    summary: string;
    recommendations: string[];
    blockers: string[];
  } | null;

  // Git state
  git: {
    branch: string;
    uncommitted_changes: boolean;
    files_changed: number;
    ahead_behind: { ahead: number; behind: number; } | null;
  };

  // Active execution
  active_runs: Array<{
    id: string;
    work_order_id: string;
    started_at: string;
    status: string;
  }>;

  // Human engagement
  last_human_interaction: {
    timestamp: string;
    type: "manual_run" | "review" | "escalation_response" | "status_update";
  } | null;

  // Environment
  environment: {
    vm: {
      provisioned: boolean;
      host: string | null;
      status: "running" | "stopped" | "unknown";
    } | null;
    env_vars_available: string[];  // Names only, not values
    runner_ready: boolean;
  };

  // Meta
  assembled_at: string;
}

interface WorkOrderSummary {
  id: string;
  title: string;
  priority: number;
  tags: string[];
  depends_on: string[];
  deps_satisfied: boolean;
}
```

### Files to Create/Modify

1. `server/shift_context.ts` (new) - Context assembly logic
2. `server/index.ts` - Add endpoint
