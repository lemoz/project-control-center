---
id: WO-2026-104
title: Budget Enforcement and Escalation
goal: Implement what happens when a project's budget runs out - parking, escalation, and survival mode.
context:
  - WO-2026-103 (economy in shift context)
  - When the budget runs out, they can't run anymore. They're parked. It escalates to me for feedback.
  - Even on minimal mode, you'll always get to do something every day
  - Balance between hard stops and keeping projects alive
acceptance_criteria:
  - Block new runs when budget exhausted
  - Auto-park project when critically over budget
  - Escalation to user when budget exhausted
  - Survival mode - minimal daily drip allows some activity
  - Clear messaging on why blocked
  - Easy path to add more budget
  - Budget alert escalations at warning/critical thresholds
  - Audit log of budget enforcement events
non_goals:
  - Automatic budget increases
  - Borrowing from other projects automatically
  - Credit/debt system
stop_conditions:
  - If enforcement is too aggressive, add grace period
priority: 2
tags:
  - economy
  - enforcement
  - escalation
estimate_hours: 3
status: done
created_at: 2026-01-13
updated_at: 2026-01-21
depends_on:
  - WO-2026-103
era: v2
---
## Enforcement Rules

### Run Blocking

```typescript
function canStartRun(projectId: string): { allowed: boolean; reason?: string } {
  const budget = getProjectBudget(projectId);
  const estimatedCost = getAverageRunCost(projectId);

  // Hard block if exhausted
  if (budget.budget_status === 'exhausted') {
    return {
      allowed: false,
      reason: 'Budget exhausted. Add more funds to continue.',
    };
  }

  // Warn but allow if critical
  if (budget.budget_status === 'critical') {
    // Allow if daily drip covers estimated cost
    if (budget.daily_drip_usd >= estimatedCost) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Budget critical ($${budget.remaining_usd.toFixed(2)} left). Estimated run cost: $${estimatedCost.toFixed(2)}`,
    };
  }

  return { allowed: true };
}
```

### Survival Mode

When budget is exhausted but daily drip is available:
- Allow ONE run per day up to daily drip amount
- Queue additional runs for next day
- Prioritize by WO priority

```typescript
interface SurvivalModeState {
  daily_drip_used: boolean;
  next_available: string;  // ISO timestamp
  queued_runs: string[];   // WO IDs waiting
}
```

## Escalation Types

```typescript
type BudgetEscalation =
  | {
      type: 'budget_warning';
      threshold: number;  // e.g., 0.25 for 25%
      message: string;
    }
  | {
      type: 'budget_critical';
      remaining_usd: number;
      runway_days: number;
    }
  | {
      type: 'budget_exhausted';
      blocked_work: string[];  // WO IDs that can't run
    }
  | {
      type: 'run_blocked';
      run_id: string;
      estimated_cost: number;
      available: number;
    };
```

## Escalation Flow

```
Budget drops below 25%
        │
        ▼
  Create escalation
  (type: budget_warning)
        │
        ▼
  Notify user (chat message)
        │
        ▼
  User can:
  ├── Add more budget
  ├── Transfer from another project
  └── Acknowledge and continue

Budget hits 0%
        │
        ▼
  Block new runs
        │
        ▼
  Create escalation
  (type: budget_exhausted)
        │
        ▼
  List blocked work
        │
        ▼
  User MUST respond to continue
```

## Database Schema

```sql
CREATE TABLE budget_enforcement_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'run_blocked', 'warning', 'critical', 'exhausted', 'survival_used'
  details TEXT,              -- JSON with context
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_budget_enforcement_project_created
  ON budget_enforcement_log(project_id, created_at DESC);
```

## UI Elements

### Run Blocked Message
```
┌─────────────────────────────────────────────┐
│ ⚠️ Cannot Start Run                         │
├─────────────────────────────────────────────┤
│ Budget exhausted for this project.          │
│                                             │
│ Remaining: $0.00                            │
│ Estimated run cost: ~$3.50                  │
│                                             │
│ Options:                                    │
│ [Add $50] [Add $100] [Transfer from...]     │
│                                             │
│ Daily drip resets in: 14 hours              │
└─────────────────────────────────────────────┘
```

### Budget Alert Banner
```
┌─────────────────────────────────────────────┐
│ 🔴 PCC budget critical: $12.30 remaining    │
│    Runway: 2.1 days    [Add Funds] [Ignore] │
└─────────────────────────────────────────────┘
```

## Global Agent Awareness

Global agent should:
1. See which projects are budget-blocked
2. Prioritize unblocking critical projects
3. Suggest budget reallocation
4. Report budget health in summaries
