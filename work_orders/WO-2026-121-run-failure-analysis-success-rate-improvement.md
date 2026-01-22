---
id: WO-2026-121
title: Run Failure Analysis & Success Rate Improvement
goal: Analyze run failure patterns and implement fixes to improve autonomous success rate from 36% toward 80% target.
context:
  - Current success rate is 36% (62 merged / 174 terminal runs)
  - Target is 80% per .control.yml success_metrics
  - 34% of runs fail, 19% have baseline failures
  - This is blocking scaling to multi-project management
acceptance_criteria:
  - Categorize failure reasons from run logs (build errors, test failures, merge conflicts, timeouts, etc.)
  - Identify top 3-5 failure patterns by frequency
  - Implement fixes for the most common failure patterns
  - Add failure reason tracking to run records
  - Create dashboard or report showing failure breakdown
  - Success rate improves measurably after fixes
non_goals:
  - Achieving 80% immediately (incremental improvement is fine)
  - Fixing every edge case failure
stop_conditions:
  - If failures are mostly due to WO quality, pivot to WO quality improvements instead
priority: 1
tags:
  - reliability
  - runner
  - metrics
  - critical
estimate_hours: 6
status: you_review
created_at: 2026-01-21
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Analysis Approach

1. Query run logs for failed runs
2. Categorize error patterns
3. Rank by frequency
4. Address top issues

## Failure Categories to Track

- Build errors (syntax, type errors, missing deps)
- Test failures (assertions, timeouts)
- Merge conflicts
- Baseline failures (tests fail before changes)
- Timeout/resource issues
- Agent errors (escalation failures, stuck loops)
