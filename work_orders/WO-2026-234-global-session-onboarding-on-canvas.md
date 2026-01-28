---
id: WO-2026-234
title: Global Session Onboarding on Canvas
status: done
priority: 1
tags:
  - ui
  - canvas
  - global-session
  - onboarding
estimate_hours: 6
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-231
  - WO-2026-232
era: v2
---
## Goal

Merge the GlobalSessionPanel onboarding flow into the canvas experience so the global agent session lifecycle is managed directly from the home page canvas, not a separate form page.

## Context

- Current session UI: `app/chat/GlobalSessionPanel.tsx` (614 lines) — standalone form-based flow
- Session state machine: onboarding → briefing → autonomous → debrief → ended
- Session API: `POST /global/sessions`, `.../start`, `.../pause`, `.../stop`, `.../end`
- The center node of the global canvas represents the global agent

## Acceptance Criteria

- [ ] No active session → center node shows idle state with prompt to start
- [ ] Starting a session transitions center node to onboarding visual state
- [ ] Onboarding checklist rendered as overlay or panel on canvas (not separate page)
- [ ] Briefing step: goals, priority projects, constraints — editable from canvas context
- [ ] "Start autonomous" triggers session loop; center node pulses, projects animate with activity
- [ ] Autonomous state: session stats visible (iterations, decisions, duration)
- [ ] Pause/resume/stop controls accessible from canvas UI
- [ ] Debrief: summary overlay with session results
- [ ] Sending a chat message still pauses autonomous (existing behavior preserved)
- [ ] Session state persists across page navigation (fetched from API on mount)
