---
id: WO-2026-022
title: Builder Iteration on Test Failures
status: ready
priority: 1
tags: [runner, builder, testing, autonomy]
created: 2026-01-06
updated: 2026-01-06
estimate_hours: 6
depends_on: [WO-2025-004]
era: autonomous
goal: "When tests fail during a builder run, feed the test output back to the builder for another iteration instead of immediately stopping. The builder should iterate until tests pass or max iterations are reached."
acceptance_criteria:
  - "When tests fail, capture full test output (stdout + stderr)"
  - "Feed test failure output back to builder as context for next iteration"
  - "Builder prompt includes: Tests failed with the following output. Fix the issues."
  - "Track iteration count (builder_iteration: 1, 2, 3...)"
  - "Configurable max iterations before giving up (default: 3)"
  - "Only proceed to reviewer when tests pass"
  - "If max iterations reached without passing, mark run as failed with all iteration history"
  - "Run details UI shows iteration history (what was tried, what failed)"
stop_conditions:
  - "If iteration causes infinite loops or runaway costs, cap strictly and fail gracefully"
  - "If test output is too large to fit in context, truncate intelligently (last N lines of failure)"
---

# Builder Iteration on Test Failures

## Goal
When tests fail during a builder run, feed the test output back to the builder for another iteration instead of immediately stopping. The builder should iterate until tests pass or max iterations are reached.

## Context
- Current flow: Builder → Tests → (fail) → STOP
- Problem: Valuable test failure output is lost; builder never gets a chance to fix
- WO-2026-020 run failed on tests but could have self-corrected with iteration
- This is foundational for autonomous operation

Current runner flow in `server/runner_agent.ts`:
- Builder produces code
- Tests run via `npm run build && npm test`
- If tests fail, run status → "failed"
- Reviewer never sees it, builder never retries

## Acceptance Criteria
- [ ] When tests fail, capture full test output (stdout + stderr)
- [ ] Feed test failure output back to builder as context for next iteration
- [ ] Builder prompt includes: "Tests failed with the following output: [output]. Fix the issues and try again."
- [ ] Track iteration count (builder_iteration: 1, 2, 3...)
- [ ] Configurable max iterations before giving up (default: 3)
- [ ] Only proceed to reviewer when tests pass
- [ ] If max iterations reached without passing, mark run as "failed" with all iteration history
- [ ] Run details UI shows iteration history (what was tried, what failed)

## Non-Goals
- Reviewer iteration on test failures (reviewer is for code quality, not test fixing)
- Automatic test generation
- Flaky test detection/retry

## Stop Conditions
- If iteration causes infinite loops or runaway costs, cap strictly and fail gracefully
- If test output is too large to fit in context, truncate intelligently (last N lines of failure)

## Technical Notes

### New flow:
```
Builder (iteration 1)
  → Build + Test
  → If fail: capture output, increment iteration, loop back to Builder
  → If pass: proceed to Reviewer
  → If max iterations: fail with history
```

### Changes needed:
1. `runner_agent.ts`: Add iteration loop around builder step
2. `runner_agent.ts`: Capture and format test output for builder context
3. `db.ts`: Track `builder_iterations` on runs table
4. `RunDetails.tsx`: Show iteration history in UI
5. Settings: Add `CONTROL_CENTER_MAX_BUILDER_ITERATIONS` (default 3)

### Builder prompt addition:
```
## Previous Attempt Failed

Your previous implementation failed tests. Here's the output:

```
[test output here]
```

Please analyze the failure and fix the issues. This is iteration {n} of {max}.
```
