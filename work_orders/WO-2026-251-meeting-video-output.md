---
id: WO-2026-251
title: Meeting video output
goal: Use Recall.ai Output Media API to display PCC content to meeting participants as bot camera or screen share
context:
  - Recall.ai Output Media renders any URL at 1280x720
  - Use web_4_core variant (~$0.60/hr)
  - Web page receives meeting audio + transcripts via WebSocket
  - Meeting connector from WO-2026-246 manages bot lifecycle
acceptance_criteria:
  - Bot displays PCC dashboard as screen share during meetings
  - Dashboard shows live project status, kanban, or meeting notes
  - Web page updates reactively based on meeting conversation
  - Toggle screen share on/off from PCC canvas UI
non_goals:
  - Custom video rendering or compositing
  - Recording the video output
stop_conditions:
  - Output Media API doesn't support screen share mode
priority: 3
tags:
  - meeting-integration
  - video
  - future
estimate_hours: 4
status: ready
created_at: 2026-01-29
updated_at: 2026-01-30
depends_on:
  - WO-2026-246
era: v2
---
## Notes

Future enhancement. Design for it in the connector service (WO-2026-246) but don't implement until audio-only is working well.

Video pipeline:
```
Recall.ai Output Media API renders a web page as bot camera/screenshare
  → PCC dashboard, project kanban, live meeting notes displayed to participants
  → Web page receives meeting audio + transcripts via WebSocket, updates reactively
```
