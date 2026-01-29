---
id: WO-2026-249
title: "Meeting invitation UI"
goal: "Canvas UI to invite the agent to a meeting and monitor status"
context:
  - "Global session overlay: app/live/GlobalSessionOverlay.tsx"
  - "Meeting connector API from WO-2026-246: POST /meetings/join, GET /meetings/active, POST /meetings/leave"
acceptance_criteria:
  - "'Invite to Meeting' button on global session overlay"
  - "Paste Google Meet link input, agent joins on submit"
  - "Status indicator (joining → active → ended)"
  - "'Leave Meeting' button"
  - "Optional: live transcript display"
non_goals:
  - "Meeting scheduling or calendar integration"
  - "Multi-meeting support (one meeting at a time)"
stop_conditions: []
priority: 2
tags:
  - meeting-integration
  - ui
estimate_hours: 2
status: backlog
created_at: 2026-01-29
updated_at: 2026-01-29
depends_on:
  - WO-2026-246
era: v2
---
## Notes

Simple UI flow:
1. User clicks "Invite to Meeting" on the global session overlay
2. Paste a Google Meet URL
3. Agent joins as "PCC Agent"
4. Status indicator shows current state
5. "Leave Meeting" button to disconnect

Follow existing patterns in GlobalSessionOverlay.tsx for component style and placement.
