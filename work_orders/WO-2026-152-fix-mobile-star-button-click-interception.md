---
id: WO-2026-152
title: Fix Mobile Star Button Click Interception
goal: Fix the flaky smoke tests where card overlay intercepts star button clicks on mobile viewport.
context:
  - Three smoke tests are skipped on chromium-mobile due to this issue
  - The card's stretched link overlay intercepts pointer events on mobile
  - Star button clicks timeout waiting for the click to register
  - Tests affected: Star/unstar reorder, Star persists across repo ID migration, Repo move preserves sidecar id
  - Error shows card div intercepts pointer events preventing button click
acceptance_criteria:
  - Star button clicks work reliably on mobile viewport
  - All three skipped smoke tests pass on chromium-mobile
  - Remove test.skip() annotations from smoke.spec.ts
  - No regression on desktop viewport
non_goals:
  - Redesigning the card layout
  - Adding new tests
stop_conditions:
  - If fix requires major card component refactor, document and escalate
priority: 2
tags:
  - bug
  - tests
  - ui
  - mobile
estimate_hours: 2
status: done
created_at: 2026-01-23
updated_at: 2026-01-26
era: v2
---
## Problem

The repo card component uses a "stretched link" pattern where an absolutely positioned link covers the entire card for click handling. On mobile viewports, this overlay intercepts clicks intended for the star toggle button, causing test timeouts.

From the Playwright error logs:
```
- <div class="card cardLink">…</div> intercepts pointer events
- waiting for element to be visible, enabled and stable
- element is visible, enabled and stable
- scrolling into view if needed
- done scrolling
- <div class="card cardLink">…</div> intercepts pointer events
```

## Affected Tests (currently skipped)

1. `Star/unstar reorder persists after refresh`
2. `Star persists across repo ID migration`
3. `Repo move preserves stable sidecar id and history`

## Investigation Notes

WO-2026-146 run attempted fixes including:
- Adding `z-index: 2` to StarToggle button
- Restructuring `.cardLink` with CSS grid
- Adding `.cardAction` class with `pointer-events: auto`

These partial fixes didn't resolve the mobile issue.

## Suggested Approach

1. Review current card structure in `app/components/RepoCard.tsx` (or equivalent)
2. Ensure star button has proper z-index stacking above the stretched link
3. Consider using `pointer-events: none` on the overlay with `pointer-events: auto` on interactive children
4. Test fix against mobile viewport in Playwright
5. Remove skip annotations once tests pass
