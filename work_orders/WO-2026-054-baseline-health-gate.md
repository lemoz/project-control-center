---
id: WO-2026-054
title: Baseline health gate for runs
goal: Fail runs early if baseline tests are already broken, preventing builders from inheriting broken infrastructure.
context:
  - server/runner_agent.ts (run execution)
  - Incident: WO-2026-048/049/050 stuck in loops fixing pre-existing test failures
acceptance_criteria:
  - Before builder starts, tests run on baseline (pre-changes) snapshot
  - If baseline tests fail, run aborts with clear error message
  - Error message identifies which tests failed on baseline
  - Builder never starts if baseline is unhealthy
  - Baseline test results cached/stored for debugging
non_goals:
  - Fixing the baseline tests (separate WO)
  - Skipping known-flaky tests
  - Complex test selection logic
stop_conditions:
  - If baseline testing adds too much latency (>2min), consider parallel execution or sampling
priority: 1
tags:
  - runner
  - testing
  - infrastructure
estimate_hours: 2
status: ready
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on: []
era: v1
---

## Problem

When tests are broken in main, builders inherit those failures. The builder:

1. Makes correct WO changes
2. Runs tests → fail (due to pre-existing bug)
3. Tries to fix the test
4. Reviewer rejects as scope creep
5. Reverts fix, tests fail again
6. Repeat until max iterations → run fails

The builder can't succeed because it inherits a broken baseline.

## Solution

Add a **baseline health check** before the builder starts:

### Flow

```
Run started
    │
    ▼
┌─────────────────────────┐
│ Create baseline snapshot │
│ (git worktree, no changes)│
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Run tests on baseline    │
│ npm test                 │
└─────────────────────────┘
    │
    ├── PASS ──► Continue to builder
    │
    └── FAIL ──► Abort run with error:
                 "Baseline tests failed - fix before running WOs"
                 List failing tests
                 Store baseline test output
```

### Implementation

In `runner_agent.ts`, before calling the builder:

```typescript
// After creating worktree, before builder starts
log("Running baseline health check...");
const baselineTestResult = await runTests(worktreePath);

if (!baselineTestResult.passed) {
  const failedTests = baselineTestResult.failures.map(f => f.name).join(", ");
  throw new RunnerError(
    "baseline_unhealthy",
    `Cannot start run: baseline tests failing. Fix these first: ${failedTests}`
  );
}

log("Baseline healthy, starting builder...");
```

### Error Handling

New run status: `baseline_failed`

```typescript
type RunStatus =
  | 'pending'
  | 'baseline_failed'  // NEW
  | 'building'
  | 'testing'
  | 'ai_review'
  // ...
```

UI shows clear message: "This run cannot proceed because tests are failing on main. Fix the baseline first."

## Files to Modify

- `server/runner_agent.ts` - Add baseline test check before builder
- `server/db.ts` - Add `baseline_failed` status
- `app/components/RunDetails.tsx` - Show baseline failure state

## Benefits

- Fail fast instead of wasting 10 iterations
- Clear signal that baseline needs fixing
- Prevents builders from attempting impossible tasks
- Saves compute/API costs on doomed runs
