---
id: WO-2026-245
title: Meeting voice agent with Pipecat + ElevenLabs
goal: Build the Pipecat voice pipeline for the meeting agent with ElevenLabs STT/TTS, LLM conversation, and PCC API read access
context:
  - "Pipecat: open-source Python framework by Daily.co (10K+ stars)"
  - Native ElevenLabs TTS/STT modules in Pipecat
  - "Existing voice tools reference: app/landing/components/VoiceWidget/voiceClientTools.ts"
  - "Global context endpoint: server/global_context.ts → GET /global/context"
  - "Shift context endpoint: GET /projects/{id}/shift-context"
  - "Communications endpoint: POST /projects/{id}/communications"
  - Agent is a voice bridge to PCC — read-only access for status, actions route through communications
acceptance_criteria:
  - Python service with Pipecat pipeline (ElevenLabs STT → LLM → ElevenLabs TTS)
  - Accepts audio input/output compatible with Recall.ai bot
  - "Read tools: get_global_context, get_project_status, get_shift_context"
  - "Action tool: send_communication (POST /projects/{id}/communications to global session)"
  - System prompt includes portfolio summary from /global/context
  - 500-800ms round-trip latency target
non_goals:
  - Meeting lifecycle management (that's WO-2026-246)
  - Meeting notes or action items (that's WO-2026-248)
  - Video output (that's WO-2026-251)
stop_conditions:
  - Pipecat doesn't support ElevenLabs modules
  - Audio format incompatible with Recall.ai
priority: 1
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 4
status: done
created_at: 2026-01-29
updated_at: 2026-01-29
depends_on: []
era: v2
---
## Unpacked

This WO has been decomposed into smaller pieces:
- **WO-2026-252** — Pipecat Python service skeleton
- **WO-2026-253** — Meeting agent PCC API tools
- **WO-2026-254** — Meeting agent LLM conversation with Claude
- **WO-2026-255** — Meeting agent ElevenLabs STT/TTS pipeline
- **WO-2026-256** — Meeting agent WebSocket audio transport

## Notes

The meeting agent architecture:
- **Read-only access**: Can query PCC APIs directly for status/context (GET requests)
- **Actions route through communications**: Sends requests/messages to the global session, which performs the actual work
- **Trusts the global session is active**: Extends the session's reach into meetings, doesn't duplicate it

Audio pipeline pattern:
```
Meeting audio → Pipecat pipeline:
  ElevenLabs STT → LLM (with PCC context) → ElevenLabs TTS
  → Audio out to meeting
```

Action pipeline (for commands like "start a shift"):
```
User says "start a shift on PCC Cloud"
  → Meeting agent sends communication: { intent: "request", summary: "Start shift on PCC Cloud" }
  → Global session picks up the communication and acts
  → Meeting agent reads updated context, speaks confirmation
```
