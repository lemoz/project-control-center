---
id: WO-2026-256
title: Meeting agent WebSocket audio transport
goal: Add WebSocket server transport to the Pipecat pipeline for Recall.ai-compatible audio I/O
context:
  - "Parent WO: WO-2026-245 (unpacked)"
  - "Full pipeline: WO-2026-255"
  - "Recall.ai integration spike: WO-2026-244"
  - "Audio format: 16kHz mono PCM s16le, 20ms frames"
  - "WebSocket endpoint that Recall.ai bot connects to for bidirectional audio streaming"
acceptance_criteria:
  - WebSocket server transport wrapping the Pipecat pipeline
  - Configurable host/port via VOICE_AGENT_HOST and VOICE_AGENT_PORT env vars
  - Audio params match Recall.ai defaults (16kHz, mono, PCM s16le, 20ms frames)
  - Pipeline accepts audio input from WebSocket, returns audio output over same connection
  - Service starts, listens on configured port, logs connection events
non_goals:
  - Recall.ai bot creation or meeting lifecycle (WO-2026-246)
  - Phone dial-in (WO-2026-250)
priority: 2
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 1
status: ready
depends_on:
  - WO-2026-255
created_at: 2026-01-29
updated_at: 2026-01-29
era: v2
---
