---
id: WO-2026-069
title: Run Phase Metrics Collection
goal: Instrument the runner to emit structured timing events and store phase-level metrics for each run.
context:
  - Need historical data to feed LLM estimation
  - Current logs have timestamps but not structured/queryable
  - This is the foundation for run time estimation
acceptance_criteria:
  - Database table for run_phase_metrics
  - Schema captures: run_id, phase, iteration, started_at, ended_at, duration_seconds, outcome
  - Runner emits metrics at each phase transition (setup, builder, test, reviewer, merge)
  - Outcome tracked (success, failed, changes_requested, approved)
  - API to query metrics by run_id or aggregate by project
non_goals:
  - UI for viewing metrics (future WO)
  - Estimation logic (WO-2026-071)
  - Real-time streaming of metrics
stop_conditions:
  - If instrumentation becomes invasive, start with key phases only
priority: 2
tags:
  - autonomous
  - metrics
  - infrastructure
estimate_hours: 2
status: ready
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on: []
era: v2
---
## Implementation

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS run_phase_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,  -- 'setup', 'builder', 'test', 'reviewer', 'merge'
  iteration INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  outcome TEXT,  -- 'success', 'failed', 'changes_requested', 'approved', 'skipped'
  metadata TEXT,  -- JSON for phase-specific data (e.g., test count, files changed)

  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_phase_metrics_run
  ON run_phase_metrics(run_id);
```

### Runner Instrumentation Points

```typescript
// In runner_agent.ts, emit metrics at:
1. After baseline health check → setup phase complete
2. After builder finishes → builder phase complete
3. After tests run → test phase complete
4. After reviewer finishes → reviewer phase complete
5. After merge → merge phase complete

// Helper function
function recordPhaseMetric(runId: string, phase: string, iteration: number, outcome: string, startedAt: Date, metadata?: object)
```

### API Endpoints

```typescript
// Get metrics for a specific run
GET /runs/:runId/metrics
Returns: RunPhaseMetric[]

// Get aggregate metrics for a project (for estimation)
GET /repos/:id/run-metrics/summary
Returns: {
  avg_setup_seconds: number;
  avg_builder_seconds: number;
  avg_reviewer_seconds: number;
  avg_iterations: number;
  total_runs: number;
  recent_runs: Array<{ wo_id, iterations, total_seconds }>;
}
```

### Files to Modify

1. `server/db.ts` - Add table and CRUD functions
2. `server/runner_agent.ts` - Emit metrics at phase transitions
3. `server/index.ts` - Add API endpoints
