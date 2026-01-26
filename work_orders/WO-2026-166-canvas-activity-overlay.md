---
id: WO-2026-166
title: Activity Log Canvas Overlay
status: ready
priority: 3
tags: [live-demo, canvas, ui]
estimate_hours: 2
depends_on: [WO-2026-164]
era: v2
updated_at: 2026-01-26
---
## Goal

Show agent activity log as an overlay on the canvas so users can see what's happening without scrolling away from the visualization.

## Context

- Current `AgentActivityPanel` is below canvas, requires scroll
- Canvas has overlay capability (voice dock uses it)
- `useShiftLogTail` and `parseShiftLog.ts` provide data

## Acceptance Criteria

- [ ] Activity log shown as compact overlay on canvas
- [ ] Shows last 10-15 activity entries
- [ ] Auto-scrolls to latest entry
- [ ] Collapsible/expandable
- [ ] Clicking entry opens detail modal (WO-2026-164)
