---
id: WO-2026-274
title: Global focus-visible accessibility baseline
goal: Add consistent, visible keyboard focus indicators across the app so keyboard users can reliably navigate and act.
context:
  - app/globals.css
  - app/components/NavBar.tsx
  - app/components/ChatWidget.tsx
  - app/settings
acceptance_criteria:
  - Add global `:focus-visible` styles in `app/globals.css` with strong contrast and no layout shift.
  - Verify visible focus states on nav links, buttons, form controls, and key interactive cards.
  - Ensure focus styles remain visible in dark surfaces, overlays, and modals.
  - Keyboard-only navigation can traverse core flows (`/`, `/portfolio`, `/projects/:id`, `/chat`, `/settings`) without losing focus context.
non_goals:
  - Full WCAG compliance remediation in one pass.
  - Semantic landmark and heading hierarchy refactor.
stop_conditions:
  - If global focus styles cause major visual regressions in critical views, stop and document conflicting components before broad rollout.
priority: 1
tags:
  - ux
  - accessibility
  - frontend
estimate_hours: 1.5
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Use `:focus-visible` rather than `:focus` to reduce mouse-click focus noise.
- Keep the outline color and offset consistent with existing brand palette.

