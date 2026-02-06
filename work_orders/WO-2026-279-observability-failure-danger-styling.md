---
id: WO-2026-279
title: Observability failure danger styling
goal: Improve failure-rate readability by visually distinguishing high-failure signals from neutral/success states.
context:
  - app/observability/components/FailureBreakdownPanel.tsx
  - app/globals.css
acceptance_criteria:
  - Failure badge uses danger styling distinct from success badge.
  - Success badge styling remains positive and visually distinct.
  - Styling is legible in dark theme and accessible for color contrast.
  - Threshold handling is documented (for example, always danger for failure badge, or threshold-based variants).
non_goals:
  - Full observability dashboard redesign.
  - New back-end metrics or aggregation logic.
stop_conditions:
  - If new badge variants introduce inconsistent styles across app badges, stop and define reusable badge variants first.
priority: 2
tags:
  - ux
  - observability
  - frontend
estimate_hours: 1
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Keep semantic color usage consistent with alert severity badges.
- Confirm readability in both low and high failure-rate scenarios.

