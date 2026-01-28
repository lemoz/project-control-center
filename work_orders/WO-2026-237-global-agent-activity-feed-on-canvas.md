---
id: WO-2026-237
title: Global Agent Activity Feed on Canvas
status: done
priority: 2
tags:
  - ui
  - canvas
  - global-session
  - activity
estimate_hours: 4
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-231
  - WO-2026-234
era: v2
---
## Goal

Show global agent session activity as an overlay or panel on the canvas so users can see what the agent is doing in real-time.

## Context

- Existing activity panel: `app/live/AgentActivityPanel.tsx` (802 lines) — project-level shift logs
- Global session events: `GET /global/sessions/{id}/events` (check_in, guidance, alert, etc.)
- Global agent decisions: DELEGATE, RESOLVE, CREATE_PROJECT, REPORT, WAIT
- Session tracks: iteration_count, decisions_count, actions_count

## Acceptance Criteria

- [ ] Activity feed visible as collapsible panel or overlay on global canvas
- [ ] Shows recent global agent decisions with timestamps
- [ ] DELEGATE decisions show which project was delegated to
- [ ] RESOLVE decisions show which escalation was resolved
- [ ] Projects flash or pulse on canvas when the global agent takes action on them
- [ ] Check-in events displayed with summary text
- [ ] Guidance/alert events highlighted prominently
- [ ] Feed auto-scrolls to latest entry, polls on interval
- [ ] Feed hidden when no active session
