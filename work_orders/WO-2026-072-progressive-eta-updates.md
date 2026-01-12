---
id: WO-2026-072
title: Progressive ETA Updates
goal: Update the run time estimate after each phase completes, providing increasingly accurate ETAs as the run progresses.
context:
  - Initial estimate is a guess, actual phase times refine it
  - After builder/reviewer, we know if iteration count will increase
  - Users want to see "time remaining" that gets more accurate
acceptance_criteria:
  - After setup: update ETA based on actual setup time
  - After builder: update ETA, note if tests passed/failed
  - After reviewer: if changes_requested, add iteration time to ETA
  - ETA stored in run record and available via API
  - Each update includes reasoning for the change
non_goals:
  - Real-time streaming updates (polling is fine)
  - Complex ML-based refinement
  - Historical accuracy tracking
stop_conditions:
  - If updates are too noisy, only update on major events
priority: 2
tags:
  - autonomous
  - estimation
  - ux
estimate_hours: 2
status: draft
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-071
era: v2
---
## Implementation

### ETA Update Points

```typescript
// After each phase, recalculate ETA
1. Post-setup:
   - actual_setup vs estimated_setup → adjust proportionally
   - "Setup took 4min (expected 6). Adjusting estimate down."

2. Post-builder:
   - If tests passed: estimate reviewer + potential merge
   - If tests failed: add another builder iteration
   - "Builder complete, tests passing. ~12 min remaining."

3. Post-reviewer:
   - If approved: estimate merge only (~1 min)
   - If changes_requested: add full iteration (builder + test + reviewer)
   - "Reviewer requested changes. Adding ~20 min for iteration 2."

4. Post-test (on retry):
   - If still failing after builder retry: estimate another iteration
   - "Tests still failing. Builder will retry. ~25 min remaining."
```

### Data Structure

```typescript
interface ProgressiveEstimate {
  phase: string;
  iteration: number;
  estimated_remaining_minutes: number;
  estimated_completion_at: string;  // ISO timestamp
  reasoning: string;
  updated_at: string;
}

// Store as JSON array in runs.eta_history
// Latest estimate in runs.current_eta_minutes
```

### API

```typescript
GET /runs/:id
Returns: {
  ...existingRunFields,
  initial_estimate: RunEstimate;
  current_eta_minutes: number;
  estimated_completion_at: string;
  eta_history: ProgressiveEstimate[];
}
```

### Files to Modify

1. `server/runner_agent.ts` - Emit ETA updates after each phase
2. `server/db.ts` - Add eta fields to runs table
3. `server/estimation.ts` - Add refinement logic
