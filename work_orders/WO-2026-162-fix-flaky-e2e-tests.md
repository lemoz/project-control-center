---
id: WO-2026-162
title: Fix Flaky E2E Tests on Mobile
goal: Re-enable the three skipped e2e tests by fixing their timeout issues on mobile viewport.
context:
  - Tests timeout on iPhone SE viewport (chromium-mobile project)
  - Star button visibility/interaction timing differs on mobile
  - Tests work fine on desktop viewport
  - Currently skipped in e2e/smoke.spec.ts
acceptance_criteria:
  - All three tests pass reliably on both desktop and mobile
  - Tests use proper waits instead of relying on timing
  - Remove test.skip() annotations
  - Tests pass 5 consecutive runs without failure
non_goals:
  - Changing test coverage or assertions
  - Adding new tests
stop_conditions:
  - If tests require significant refactoring of the app itself, escalate
priority: 3
tags:
  - testing
  - e2e
  - stability
estimate_hours: 2
status: done
created_at: 2026-01-26
depends_on: []
era: v2
updated_at: 2026-01-26
---
## Skipped Tests

1. **Star/unstar reorder persists after refresh** (line 96)
2. **Star persists across repo ID migration** (line 121)
3. **Repo move preserves stable sidecar id and history** (line 237)

## Root Cause

These tests interact with the star button on repo cards. On mobile:
- Cards are smaller and may have different layout
- Star button may take longer to become interactive
- `waitForStarToggle` helper may not wait long enough

## Suggested Fixes

1. Use `toBeVisible()` AND `toBeEnabled()` before clicking
2. Add explicit `waitForLoadState('networkidle')` after page loads
3. Increase individual test timeouts if needed: `test.setTimeout(90_000)`
4. Use `locator.click({ force: true })` only as last resort

## Testing

```bash
# Run just these tests on mobile
npx playwright test smoke.spec.ts --project=chromium-mobile -g "Star"

# Run full suite 5 times
for i in {1..5}; do npm run test:e2e; done
```
