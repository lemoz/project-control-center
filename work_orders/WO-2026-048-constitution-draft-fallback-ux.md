---
id: WO-2026-048
title: Constitution draft fallback UX improvement
goal: Improve messaging when AI draft falls back to local merge so it doesn't look like an error.
context:
  - app/components/ConstitutionGenerationWizard.tsx
  - WO-2026-025 (added draftPreservesBase guard)
acceptance_criteria:
  - Change fallback message from error-style to info-style
  - Message explains what happened positively ("Preserving your existing content, merging new insights")
  - Remove yellow/orange warning styling, use neutral or success styling
  - Optionally show what was preserved vs added
non_goals:
  - Changing the fallback logic itself
  - Improving AI draft quality
stop_conditions:
  - None expected
priority: 4
tags:
  - ux
  - constitution
  - polish
estimate_hours: 1
status: ready
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on:
  - WO-2026-025
era: v1
---

## Problem

When generating a constitution draft, if the AI omits existing content, the system correctly falls back to local merge. However, the current messaging looks like an error:

```
AI draft omitted existing content; falling back to local merge.
Falling back to local draft merge.
```

This is displayed in yellow/warning style, making users think something went wrong when it's actually working correctly.

## Solution

Update the messaging to be positive and informative:

**Before:**
- Yellow/warning styling
- "AI draft omitted existing content; falling back to local merge"
- Sounds like a failure

**After:**
- Neutral or success styling (blue info or green)
- "Preserving your existing content while adding new insights"
- Sounds like intended behavior

## Files to modify

- `app/components/ConstitutionGenerationWizard.tsx` - Update the fallback message and styling
