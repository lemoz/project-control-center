---
id: WO-2026-167
title: Collapsible Voice Guide
status: done
priority: 3
tags:
  - live-demo
  - voice
  - ui
estimate_hours: 2
updated_at: 2026-01-26
---
## Goal

Make the voice guide a collapsible slide-out card to save screen space on the live canvas.

## Context

- Voice dock at `app/live/` takes fixed space in top-right
- On smaller screens it obscures significant canvas area
- Users may not always need voice active

## Acceptance Criteria

- [ ] Voice guide slides out from right edge when activated
- [ ] Collapsed state shows small tab/button
- [ ] Expanded state shows full voice controls
- [ ] Smooth slide animation
- [ ] State persists (remembers collapsed/expanded)
- [ ] Keyboard shortcut to toggle (V key)
