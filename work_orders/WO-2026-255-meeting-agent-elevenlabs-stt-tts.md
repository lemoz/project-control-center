---
id: WO-2026-255
title: Meeting agent ElevenLabs STT/TTS pipeline
goal: Wire ElevenLabs speech-to-text and text-to-speech into the Pipecat pipeline with the Claude LLM processor
context:
  - "Parent WO: WO-2026-245 (unpacked)"
  - "Service skeleton: WO-2026-252"
  - "LLM processor: WO-2026-254"
  - "ElevenLabs API key: CONTROL_CENTER_ELEVENLABS_API_KEY"
  - "Voice ID: ELEVENLABS_VOICE_ID"
  - "Existing TTS reference: server/narration_tts.ts (eleven_turbo_v2 model)"
  - "Pipecat has native ElevenLabs modules"
acceptance_criteria:
  - ElevenLabs STT processor in pipeline (before LLM)
  - ElevenLabs TTS processor in pipeline (after LLM)
  - Full pipeline wired: STT → Claude LLM → TTS
  - Configurable voice ID, STT/TTS model IDs via env vars
  - Pipeline runs end-to-end (can test with local mic input if available)
  - 500-800ms round-trip latency target
non_goals:
  - WebSocket transport for Recall.ai (WO-2026-256)
  - Meeting lifecycle (WO-2026-246)
stop_conditions:
  - Pipecat ElevenLabs modules not available or incompatible
priority: 1
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 1.5
status: backlog
depends_on:
  - WO-2026-252
  - WO-2026-254
created_at: 2026-01-29
updated_at: 2026-01-29
era: v2
---
