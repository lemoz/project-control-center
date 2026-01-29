---
id: WO-2026-254
title: Meeting agent LLM conversation with Claude
goal: Wire Claude as the LLM in the Pipecat pipeline with system prompt, tool calling, and portfolio context injection
context:
  - "Parent WO: WO-2026-245 (unpacked)"
  - "Service skeleton: WO-2026-252"
  - "PCC tools: WO-2026-253"
  - "Must use Claude (Anthropic), NOT OpenAI — the failed run incorrectly used gpt-4o-mini"
  - "Pipecat has anthropic integration: check pipecat.services.anthropic or similar"
  - "System prompt should include portfolio summary from /global/context"
  - "Existing voice agent system prompt pattern: app/landing/components/VoiceWidget/useVoiceAgent.ts"
acceptance_criteria:
  - Pipecat LLM processor using Claude (anthropic SDK) not OpenAI
  - System prompt built from BASE_SYSTEM_PROMPT + live portfolio summary
  - Tool calling wired to PCC tool callbacks from WO-2026-253
  - Temperature, max_tokens tuned for conversational voice responses (short, direct)
  - ANTHROPIC_API_KEY env var (not OPENAI_API_KEY)
non_goals:
  - STT/TTS integration (WO-2026-255)
  - Audio transport (WO-2026-256)
priority: 1
tags:
  - meeting-integration
  - voice
  - pipecat
estimate_hours: 1.5
status: ready
depends_on:
  - WO-2026-252
created_at: 2026-01-29
updated_at: 2026-01-29
era: v2
---
