---
id: WO-2026-246
title: Meeting connector service
goal: Service that orchestrates meeting lifecycle — accepts a Google Meet URL, creates a Recall.ai bot, connects bot audio to the Pipecat voice agent, reports status back to PCC
context:
  - Recall.ai bot creation via their API (validated in WO-2026-244)
  - Pipecat voice agent from WO-2026-245
  - PCC API server at server/index.ts
  - Bot should appear as 'PCC Agent' (configurable name)
acceptance_criteria:
  - POST /meetings/join { url, bot_name } → bot joins meeting → bidirectional audio flowing
  - GET /meetings/active → current meeting status (joining/active/ended)
  - POST /meetings/leave → bot leaves cleanly
  - Bot appears as 'PCC Agent' (configurable)
  - Meeting status tracked in PCC
  - Graceful error handling for invalid URLs, failed joins, disconnections
non_goals:
  - UI for meeting management (that's WO-2026-249)
  - Video output (that's WO-2026-251)
stop_conditions:
  - Recall.ai bot cannot connect to Pipecat pipeline
priority: 1
tags:
  - meeting-integration
  - infrastructure
estimate_hours: 3
status: done
created_at: 2026-01-29
updated_at: 2026-01-30
depends_on:
  - WO-2026-244
  - WO-2026-245
era: v2
---
## Notes

This is the orchestration layer between Recall.ai and the Pipecat voice agent. It handles:
1. Meeting join/leave lifecycle
2. Wiring Recall.ai bot audio ↔ Pipecat pipeline
3. Status reporting back to PCC
4. Error recovery (bot disconnected, meeting ended externally, etc.)
