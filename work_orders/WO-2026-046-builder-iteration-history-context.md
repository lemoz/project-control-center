---
id: WO-2026-046
title: Builder iteration history context
goal: Pass previous iteration history to builder prompt so it can learn from past attempts and avoid repeating mistakes.
context:
  - server/runner_agent.ts (buildBuilderPrompt, iteration loop)
  - .system/runs/{id}/iteration_history.json (existing history storage)
acceptance_criteria:
  - Builder prompt includes formatted history of all previous iterations (summary, test status, reviewer verdict, reviewer notes).
  - Test output is excluded from history to keep context compact.
  - New rule added to builder prompt: "Learn from previous iteration feedback - do not repeat the same mistakes."
  - History is only shown for iterations < current (not the current one).
  - Format is human-readable markdown with iteration headers.
non_goals:
  - Summarizing or compressing history (full notes preserved).
  - Passing history to reviewer (only builder needs it).
  - Limiting history to last N iterations (show all for now).
stop_conditions:
  - If context grows too large, consider truncation strategies.
priority: 2
tags:
  - runner
  - builder
  - context
  - quality
estimate_hours: 1
status: done
created_at: 2026-01-09
updated_at: 2026-01-09
depends_on: []
era: v1
---
## Notes

Implemented 2026-01-09. Problem discovered when WO-2026-025 kept making the same mistakes (WO metadata edits flagged 5x, e2e/.tmp artifacts flagged 4x) because builder had no memory of previous iterations.

Added `formatIterationHistory()` function that formats:
```
## Previous Iterations

### Iteration 1
**Builder:** <summary>
**Tests:** ✓ passed / ✗ failed
**Reviewer:** changes_requested
- <note 1>
- <note 2>
```

Each iteration adds ~300-500 tokens of useful context (vs ~3-4k with test output).

Commit: 2f617f9 "Add iteration history context to builder prompt"
