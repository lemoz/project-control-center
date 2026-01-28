---
id: WO-2026-073
title: UI Run Estimation Display
goal: Display run time estimates and progressive ETAs in the run details UI.
context:
  - Users want to know how long a run will take
  - Estimates should be visible before run starts and update during
  - Show confidence level and reasoning for transparency
acceptance_criteria:
  - Run details page shows initial estimate before/during run
  - Shows current ETA with time remaining
  - Shows confidence badge (high/medium/low)
  - Hover/click shows reasoning
  - Progress indicator shows phase (setup → builder → test → reviewer → merge)
  - ETA updates visible in real-time (polling)
non_goals:
  - Historical accuracy dashboard
  - Notifications when ETA changes significantly
  - Batch estimation for multiple WOs
stop_conditions:
  - If polling is problematic, show static estimate only
priority: 3
tags:
  - ui
  - estimation
  - ux
estimate_hours: 2
status: done
created_at: 2026-01-12
updated_at: 2026-01-28
depends_on:
  - WO-2026-072
era: v2
---
## Implementation

### Run Details Page Changes

```tsx
// New component: RunEstimateDisplay
<RunEstimateDisplay
  initialEstimate={run.initial_estimate}
  currentEta={run.current_eta_minutes}
  estimatedCompletion={run.estimated_completion_at}
  confidence={run.initial_estimate?.confidence}
  reasoning={run.initial_estimate?.reasoning}
  phase={run.current_phase}
  iteration={run.builder_iteration}
/>

// Visual elements:
┌─────────────────────────────────────────────────┐
│ Estimated Time: ~35 min                    [?]  │
│ ████████████░░░░░░░░  Builder (iter 1)          │
│ Completing around 4:45 PM                       │
│                                                 │
│ Confidence: Medium                              │
│ "Multiple files to modify, new API pattern"    │
└─────────────────────────────────────────────────┘
```

### Progress Phases Visual

```
○───○───○───○───○
Setup  Build  Test  Review  Merge

● = completed
◐ = in progress
○ = pending
```

### Polling

- Poll /runs/:id every 10 seconds while run is active
- Update ETA display when current_eta_minutes changes
- Stop polling when run completes

### Files to Modify

1. `app/runs/[id]/RunDetails.tsx` - Add estimate display
2. `app/runs/[id]/RunEstimateDisplay.tsx` - New component
3. `app/runs/[id]/RunPhaseProgress.tsx` - New component for phase visualization
