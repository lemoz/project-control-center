---
id: WO-2026-244
title: Recall.ai integration spike
goal: Set up Recall.ai API access and validate two-way audio with a Google Meet bot using ElevenLabs voice
context:
  - Recall.ai docs at docs.recall.ai
  - Output Media API renders a web page as bot camera — build a simple page that uses ElevenLabs ConversationAPI for the spike
  - "Existing voice agent: app/landing/components/VoiceWidget/ (reference for ElevenLabs integration patterns)"
  - Part of voice agent meeting integration epic (WO-244 through WO-251)
acceptance_criteria:
  - Recall.ai API key configured and authenticated
  - Bot joins a test Google Meet call
  - Bot speaks a greeting using ElevenLabs TTS
  - Bot transcribes participant speech
  - Audio round-trip latency measured and documented
non_goals:
  - Full Pipecat pipeline (that's WO-2026-245)
  - PCC integration
stop_conditions:
  - Recall.ai API access denied or unavailable
  - Output Media API doesn't support audio injection
priority: 1
tags:
  - meeting-integration
  - voice
  - spike
estimate_hours: 3
status: building
created_at: 2026-01-29
updated_at: 2026-01-30
depends_on: []
era: v2
---
## Notes

This is the foundational spike for meeting integration. Validate that Recall.ai can:
1. Join Google Meet with two-way audio
2. Pipe audio through a web page (Output Media API)
3. The web page can use ElevenLabs ConversationAPI for voice

Measure latency end-to-end: participant speaks → bot hears → bot responds → participant hears.

## Credentials & Configuration (AVAILABLE)

All credentials are configured in `.env` — the builder has full access:

- **Recall.ai API key**: `CONTROL_CENTER_RECALL_API_KEY` in `.env`
- **Recall.ai auth prefix**: `CONTROL_CENTER_RECALL_API_PREFIX=Token` in `.env`
- **Recall.ai bot creation endpoint**: `CONTROL_CENTER_RECALL_CREATE_URL=https://us-west-2.recall.ai/api/v1/bot/` in `.env`
- **Recall.ai API docs**: https://docs.recall.ai — auth header is `Authorization: Token <key>`
- **ElevenLabs API key**: `ELEVENLABS_API_KEY` in `.env`
- **ElevenLabs agent ID**: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` in `.env`
- **External API calls**: YES — this run is allowed to call Recall.ai and ElevenLabs APIs. Sandbox is disabled (`PCC_BUILDER_SANDBOX=none`).
- **Env var config reference**: `.env.example` has the full schema for RECALL and ELEVENLABS vars
