---
id: WO-2026-102
title: Budget Allocation System
goal: Enable allocating dollar budgets to projects from a global pool with monthly cycles and daily drip.
context:
  - WO-2026-101 (cost tracking foundation)
  - User sets global monthly budget
  - Allocates to projects
  - Daily drip ensures everyone gets baseline activity
  - Budget for the month is spread out evenly - always get to do something every day
acceptance_criteria:
  - Global budget setting (monthly amount user is willing to spend)
  - Per-project budget allocation from global pool
  - Monthly budget cycle (resets, tracks period)
  - Daily drip calculation (monthly / days remaining)
  - Unallocated pool tracking
  - API endpoints for budget CRUD
  - UI for setting global budget and allocating to projects
  - Budget transfer between projects
non_goals:
  - Enforcement when over budget (that's WO-2026-104)
  - Agent earning money (that's WO-2026-105)
  - Automatic allocation based on priority
stop_conditions:
  - If budget math gets complex, simplify to basics first
priority: 2
tags:
  - economy
  - infrastructure
  - budgeting
estimate_hours: 4
status: ready
created_at: 2026-01-13
updated_at: 2026-01-13
depends_on:
  - WO-2026-101
era: v2
---
## Data Model

```typescript
interface GlobalBudget {
  monthly_budget_usd: number;      // What user is willing to spend
  current_period_start: string;    // e.g., "2026-01-01"
  current_period_end: string;      // e.g., "2026-01-31"

  // Calculated
  allocated_usd: number;           // Sum of project allocations
  unallocated_usd: number;         // monthly - allocated
  spent_usd: number;               // From cost tracking
  remaining_usd: number;           // monthly - spent
}

interface ProjectBudget {
  project_id: string;

  // Allocation
  monthly_allocation_usd: number;  // Budget for this period

  // Tracking
  spent_usd: number;               // From cost tracking
  remaining_usd: number;           // allocation - spent

  // Daily drip
  daily_drip_usd: number;          // remaining / days left in period

  // Status
  runway_days: number;             // At current burn rate
  budget_status: 'healthy' | 'warning' | 'critical' | 'exhausted';
}
```

## Database Schema

```sql
-- Global settings (single row)
CREATE TABLE budget_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  monthly_budget_usd REAL NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Per-project allocations
CREATE TABLE project_budgets (
  project_id TEXT PRIMARY KEY,
  monthly_allocation_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

## Budget Status Thresholds

```typescript
function getBudgetStatus(remaining: number, allocation: number): BudgetStatus {
  const pct = remaining / allocation;
  if (pct <= 0) return 'exhausted';
  if (pct < 0.1) return 'critical';   // < 10%
  if (pct < 0.25) return 'warning';   // < 25%
  return 'healthy';
}
```

## Daily Drip Logic

```typescript
function calculateDailyDrip(budget: ProjectBudget, today: Date): number {
  const periodEnd = new Date(globalBudget.current_period_end);
  const daysRemaining = Math.max(1, diffDays(today, periodEnd));
  return budget.remaining_usd / daysRemaining;
}
```

This ensures:
- Budget spreads evenly across remaining days
- Even broke projects get something at period reset
- Natural pacing - can't blow entire budget day 1

## API Endpoints

```
GET /budget
  Response: GlobalBudget

PUT /budget
  Body: { monthly_budget_usd: number }

GET /projects/:id/budget
  Response: ProjectBudget

PUT /projects/:id/budget
  Body: { monthly_allocation_usd: number }

POST /projects/:id/budget/transfer
  Body: { to_project_id: string, amount_usd: number }
```

## UI

### Global Budget Settings
```
┌─────────────────────────────────────────────┐
│ Monthly Budget                              │
├─────────────────────────────────────────────┤
│ Total: $500/month          [Edit]           │
│                                             │
│ Allocated: $420 (84%)                       │
│ ████████████████████░░░░                    │
│                                             │
│ Unallocated: $80                            │
│                                             │
│ Period: Jan 1 - Jan 31 (18 days left)       │
└─────────────────────────────────────────────┘
```

### Project Budget Allocation
```
┌─────────────────────────────────────────────┐
│ Project Budgets                             │
├─────────────────────────────────────────────┤
│ PCC              $150  ████████░░  $45 left │
│ VideoNest API    $120  ██████░░░░  $72 left │
│ Python API       $100  █████████░  $12 left │
│ Dandelion        $50   ██████████  $50 left │
│                                             │
│ [+ Allocate More]                           │
└─────────────────────────────────────────────┘
```

## Period Reset

At period end (or manual reset):
1. Archive current period costs
2. Reset project `spent_usd` to 0
3. Carry over allocations (or prompt to re-allocate)
4. Log period summary
