---
id: WO-2026-101
title: Cost Tracking Foundation
goal: Track actual dollar costs per project, run, and operation to enable budget-aware agent economics.
context:
  - Using Codex and Claude Code with known API pricing
  - Need real cost data before we can allocate budgets
  - Foundation for agent economy system
  - "Currency is dollars - no abstraction, real money"
acceptance_criteria:
  - Add cost_tracking table to track costs per operation (run, chat, etc.)
  - Calculate and store cost per run based on token usage
  - API endpoint GET /projects/:id/costs returns cost summary
  - Cost breakdown by category (builder, reviewer, chat, etc.)
  - Daily/weekly/monthly aggregations
  - Store token counts AND dollar amounts (prices change)
  - UI showing cost history per project
non_goals:
  - Budget allocation (that's WO-2026-102)
  - Budget enforcement (that's WO-2026-104)
  - Predictive cost estimation
stop_conditions:
  - If token counting is unreliable, document gaps
priority: 2
tags:
  - economy
  - infrastructure
  - data
estimate_hours: 4
status: ready
created_at: 2026-01-13
updated_at: 2026-01-13
depends_on: []
era: v2
---
## Data Model

```typescript
interface CostRecord {
  id: string;
  project_id: string;
  run_id?: string;           // null for non-run costs (chat, etc.)
  category: 'builder' | 'reviewer' | 'chat' | 'handoff' | 'other';

  // Token counts
  input_tokens: number;
  output_tokens: number;

  // Cost calculation
  model: string;             // e.g., "claude-3-opus", "gpt-4"
  input_cost_per_1k: number; // price at time of operation
  output_cost_per_1k: number;
  total_cost_usd: number;    // calculated

  // Metadata
  created_at: string;
  description?: string;      // e.g., "builder iteration 3"
}

interface ProjectCostSummary {
  project_id: string;
  period: 'day' | 'week' | 'month' | 'all_time';

  total_cost_usd: number;
  cost_by_category: Record<string, number>;

  run_count: number;
  avg_cost_per_run: number;

  token_totals: {
    input: number;
    output: number;
  };
}
```

## Database Schema

```sql
CREATE TABLE cost_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  category TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  model TEXT NOT NULL,
  input_cost_per_1k REAL NOT NULL,
  output_cost_per_1k REAL NOT NULL,
  total_cost_usd REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_cost_records_project_created
  ON cost_records(project_id, created_at DESC);
```

## API Endpoints

```
GET /projects/:id/costs
  ?period=day|week|month|all_time
  ?category=builder|reviewer|chat|all

Response: ProjectCostSummary

GET /projects/:id/costs/history
  ?days=30

Response: { daily: [{ date, total_cost_usd, breakdown }] }
```

## Pricing Reference

Current pricing to embed (as of Jan 2026):
- Claude 3 Opus: $15/M input, $75/M output
- Claude 3.5 Sonnet: $3/M input, $15/M output
- GPT-4: $30/M input, $60/M output

Store these in a config so they can be updated.

## Integration Points

1. **Runner** - Log costs after each builder/reviewer iteration
2. **Chat** - Log costs after each chat completion
3. **Handoff generator** - Log costs for handoff generation

## UI

Simple cost display on project page:
```
┌─────────────────────────────────────┐
│ Costs (This Month)                  │
├─────────────────────────────────────┤
│ Total: $45.23                       │
│ ├── Builder: $32.10                 │
│ ├── Reviewer: $8.50                 │
│ ├── Chat: $3.12                     │
│ └── Other: $1.51                    │
│                                     │
│ Runs: 12 | Avg: $3.38/run           │
└─────────────────────────────────────┘
```
