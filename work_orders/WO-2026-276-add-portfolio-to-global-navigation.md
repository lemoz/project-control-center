---
id: WO-2026-276
title: Add Portfolio to global navigation
goal: Make Portfolio a first-class global destination with explicit nav entry and correct active-state logic.
context:
  - app/components/NavBar.tsx
  - app/portfolio/page.tsx
  - app/page.tsx
acceptance_criteria:
  - Add `Portfolio` to global nav in desktop and mobile views.
  - Home and Portfolio use distinct active-state logic (no ambiguous shared highlight).
  - Existing project-context sub-nav behavior remains intact.
  - Navigation to `/portfolio` works from every primary route.
non_goals:
  - Portfolio page feature expansion (search/filters handled separately).
  - Project-level sub-nav redesign.
stop_conditions:
  - If active-state logic introduces regressions for existing route highlighting, stop and document exact route conflicts.
priority: 2
tags:
  - ux
  - navigation
  - frontend
estimate_hours: 1
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Ensure route matching is deterministic for `/`, `/portfolio`, and `/projects/*`.
- Keep nav labels concise for mobile width constraints.

