---
id: WO-2026-109
title: Fix Flaky Repo Move Test on Mobile
goal: Fix the intermittent test failure in "Repo move preserves stable sidecar id and history" on chromium-mobile
context:
  - Test passes on desktop but times out on mobile
  - Fails looking for 'button[aria-label="Unstar project"]' after repo move
  - Likely a timing/race condition on slower mobile viewport
  - e2e/smoke.spec.ts:231
acceptance_criteria:
  - Test passes reliably on both desktop and mobile
  - No flaky failures in CI
  - Root cause identified and fixed (not just increased timeout)
non_goals:
  - Skipping the test
  - Desktop-only coverage
stop_conditions:
  - If root cause is unclear after investigation, add detailed logging and report findings
priority: 2
tags:
  - testing
  - flaky
  - e2e
  - bugfix
estimate_hours: 2
status: done
created_at: 2026-01-14
updated_at: 2026-01-15
depends_on: []
era: v2
---
## Problem

The test `Repo move preserves stable sidecar id and history` fails intermittently on chromium-mobile:

```
Error: expect(locator).toBeVisible() failed
Locator: locator('.grid .card.cardLink').filter({ hasText: 'beta' }).locator('button[aria-label="Unstar project"]')
Expected: visible
Timeout: 10000ms
```

## Investigation Areas

1. **Race condition** - Page not fully loaded after repo move refresh
2. **Mobile viewport** - Element might be off-screen or hidden on mobile
3. **Async state** - Star state not synced after repo ID migration
4. **Selector specificity** - Card might exist but star button not rendered yet

## Likely Fix

Add explicit waits or improve selector reliability:
- Wait for network idle after refresh
- Wait for specific element state before asserting
- Check if element is in viewport on mobile
