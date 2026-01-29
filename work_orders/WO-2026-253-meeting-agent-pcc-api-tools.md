---
id: WO-2026-253
title: Meeting agent PCC API tools
goal: Async PCC client and tool definitions for the meeting voice agent to query portfolio status and send communications
context:
  - "Parent WO: WO-2026-245 (unpacked)"
  - "Service skeleton: WO-2026-252"
  - "Global context endpoint: GET /global/context"
  - "Shift context endpoint: GET /projects/{id}/shift-context"
  - "Communications endpoint: POST /projects/{id}/communications"
  - "Repos endpoint: GET /repos"
  - Failed run has a working PccClient class to reference
acceptance_criteria:
  - PccClient class with async methods: get_global_context, get_project_status, get_shift_context, send_communication
  - Tool definitions as structured dicts compatible with Claude tool_use format
  - Tool callback map linking tool names to PccClient methods
  - summarize_global_context() helper that produces a concise portfolio summary string
  - Basic error handling (timeouts, non-200 responses)
non_goals:
  - LLM integration or prompt construction (WO-2026-254)
  - Audio pipeline (WO-2026-255)
priority: 2
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 1
status: you_review
depends_on:
  - WO-2026-252
created_at: 2026-01-29
updated_at: 2026-01-29
era: v2
---
