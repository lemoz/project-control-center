---
id: WO-2026-053
title: Fix flaky Kanban column test selectors
goal: Fix the e2e test that fails due to loose text matching on Kanban column names.
context:
  - e2e/smoke.spec.ts:343-352 (Project page renders Kanban columns)
  - Root cause: getByText('Done') matches Constitution textarea content
  - Blocking WO-2026-048, 049, 050 runs
acceptance_criteria:
  - Kanban column assertions use exact text matching
  - Test passes reliably without matching Constitution preview content
  - All 22 smoke tests pass
non_goals:
  - Refactoring other tests
  - Changing Kanban UI
stop_conditions:
  - None expected
priority: 1
tags:
  - testing
  - bugfix
  - urgent
estimate_hours: 0.5
status: ready
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on: []
era: v1
---

## Problem

The "Project page renders Kanban columns" test is flaky:

```
Error: strict mode violation: getByText('Done') resolved to 3 elements:
1) <textarea>...# Constitution...Done...</textarea>
2) <textarea>...# Constitution...Done...</textarea>
3) <div>Done</div>  ← The actual Kanban column
```

The Constitution preview textareas contain text that includes "Done", "Ready", etc., causing loose `getByText()` selectors to match multiple elements.

This blocks multiple WO runs - builders try to fix it, reviewers reject as scope creep, repeat until max iterations.

## Solution

Update the test assertions to use exact matching:

```typescript
// Before
await expect(page.getByText("Backlog")).toBeVisible();
await expect(page.getByText("Ready")).toBeVisible();
await expect(page.getByText("Building")).toBeVisible();
await expect(page.getByText("Done")).toBeVisible();

// After
const board = page.locator(".board");
await expect(board.getByText("Backlog", { exact: true })).toBeVisible();
await expect(board.getByText("Ready", { exact: true })).toBeVisible();
await expect(board.getByText("Building", { exact: true })).toBeVisible();
await expect(board.getByText("Done", { exact: true })).toBeVisible();
```

Also scope to `.board` to ensure we're checking the Kanban board, not the whole page.

## Files to Modify

- `e2e/smoke.spec.ts` - Update Kanban column assertions (~line 343-352)
