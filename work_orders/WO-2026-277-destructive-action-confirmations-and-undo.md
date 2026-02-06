---
id: WO-2026-277
title: Destructive action confirmations and undo
goal: Add explicit guardrails for destructive actions to prevent accidental configuration loss.
context:
  - app/settings/NetworkWhitelistSettingsForm.tsx
  - app/live/GlobalSessionOverlay.tsx
acceptance_criteria:
  - "Network whitelist Remove requires user confirmation before execution."
  - "Global session Stop requires user confirmation before execution."
  - Network whitelist removal includes recoverable feedback (undo or clear restoration path).
  - Confirmation copy communicates impact clearly and action labels are unambiguous.
non_goals:
  - Full design-system modal framework buildout.
  - Back-end authorization policy changes.
stop_conditions:
  - If confirmation implementation blocks legitimate repeated operator actions, stop and propose a lower-friction pattern with equivalent safety.
priority: 1
tags:
  - ux
  - safety
  - settings
estimate_hours: 2
status: ready
created_at: 2026-02-06
updated_at: 2026-02-06
depends_on: []
era: v1
---
## Implementation Notes
- Use consistent confirmation language and button ordering across both flows.
- Keep confirmation interactions keyboard-accessible and screen-reader friendly.
