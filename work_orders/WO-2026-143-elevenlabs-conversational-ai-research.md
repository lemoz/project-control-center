---
id: WO-2026-143
title: ElevenLabs Conversational AI Integration Research
goal: Explore using ElevenLabs Conversational AI platform for the landing page voice experience instead of building from primitives.
context:
  - WO-2026-141 (Voice Q&A Research) proposed Web Speech API + Whisper
  - ElevenLabs has full Conversational AI platform with voice agents
  - 75ms latency, turn-taking model, tool calling, 31 languages
  - Can connect to Claude/GPT for answer generation
  - SDKs for React, Swift, Kotlin
  - This could replace building STT + LLM + TTS pipeline ourselves
acceptance_criteria:
  - Document ElevenLabs Conversational AI capabilities in detail
  - Explore agent configuration (system prompt, knowledge base, tools)
  - Understand how to connect to Claude for PCC-specific answers
  - Evaluate React SDK for landing page integration
  - Identify tool calling capabilities (can agent call PCC APIs?)
  - Assess latency, reliability, and user experience
  - Compare cost vs building from primitives
  - Prototype or describe integration architecture
  - Identify limitations or blockers
non_goals:
  - Full implementation
  - Comparing all voice platforms (focus on ElevenLabs)
  - Phone/telephony features (web only for now)
stop_conditions:
  - If ElevenLabs requires enterprise contract, document and note alternatives
  - If latency or quality is insufficient, document findings
priority: 2
tags:
  - research
  - voice
  - ui
  - ux
  - integration
estimate_hours: 3
status: ready
created_at: "2026-01-22"
updated_at: "2026-01-22"
depends_on: []
era: v2
---
## Research Questions

1. **Agent Configuration**
   - How do you define the agent's personality and behavior?
   - Can we inject PCC context (current runs, WOs, metrics) into the system prompt?
   - How does the knowledge base work? Can we feed it PCC docs?
   - What's the token/context limit for the agent?

2. **LLM Connection**
   - Can we connect to Claude (Anthropic) as the backing LLM?
   - How is context passed between ElevenLabs and the LLM?
   - Can we use our own API keys or must we use theirs?
   - What's the latency impact of external LLM vs their hosted models?

3. **Tool Calling**
   - Can the voice agent call external APIs during conversation?
   - Example: User asks "What's happening now?" → Agent calls /shift-context
   - How are tool results incorporated into the response?
   - What's the latency impact of tool calls?

4. **React SDK Integration**
   - What does the React component API look like?
   - How do we handle authentication/API keys client-side?
   - Can we get events for conversation state (listening, speaking, etc.)?
   - How do we pass dynamic context (canvas state, focused node)?

5. **Turn-Taking & UX**
   - How does the turn-taking model work?
   - Can users interrupt? How is that handled?
   - What visual indicators are provided (or do we build our own)?
   - How does push-to-talk vs always-listening work?

6. **Cost Analysis**
   - What's the pricing model? (per minute, per conversation, per character)
   - How does it compare to building: Web Speech + Whisper API + Claude + TTS?
   - Are there free tier limits for development/demo?

7. **Limitations & Blockers**
   - Any compliance concerns (GDPR, data residency)?
   - Can we use zero-retention mode for privacy?
   - What happens if ElevenLabs is down? Fallback strategy?
   - Any browser compatibility issues?

## Integration Architecture (To Explore)

```
┌─────────────────────────────────────────────────────────────────┐
│  LANDING PAGE (React)                                           │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐ │
│  │  Orbital Canvas │    │  ElevenLabs React SDK               │ │
│  │                 │    │  ┌─────────────────────────────────┐│ │
│  │  [WO nodes]     │◄───│  │  Voice Agent Widget             ││ │
│  │                 │    │  │  - Mic button                   ││ │
│  │  Focus sync     │    │  │  - Speaking indicator           ││ │
│  │                 │    │  │  - Transcript display           ││ │
│  └─────────────────┘    │  └─────────────────────────────────┘│ │
│                         └──────────────┬──────────────────────┘ │
└────────────────────────────────────────┼────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ELEVENLABS CONVERSATIONAL AI                                   │
│                                                                 │
│  Agent Config:                                                  │
│  - System prompt: "You are a guide for PCC..."                  │
│  - Voice: [selected voice]                                      │
│  - LLM: Claude (via Anthropic API)                              │
│  - Tools: getPCCContext, getWorkOrderDetails, getRunStatus      │
│                                                                 │
│  Flow:                                                          │
│  User speaks → STT → LLM (with tools) → TTS → User hears        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                         │
                                         │ Tool calls
                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  PCC API                                                        │
│                                                                 │
│  /projects/:id/shift-context    → Current state                 │
│  /repos/:id/work-orders/:id     → WO details                    │
│  /runs/:id                      → Run status                    │
│  /global/context                → Portfolio overview            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Documentation to Review

- ElevenLabs Conversational AI Overview: https://elevenlabs.io/docs/conversational-ai/overview
- Agents Platform: https://elevenlabs.io/docs/agents-platform/overview
- React SDK: (find in docs)
- Tool/Function calling: (find in docs)
- LLM configuration: (find in docs)

## Comparison: ElevenLabs vs Build-Your-Own

| Aspect | ElevenLabs | Build-Your-Own |
|--------|------------|----------------|
| STT | Included (fine-tuned) | Web Speech API or Whisper |
| LLM | Connect to Claude/GPT | Direct Claude API |
| TTS | Included (high quality) | Web Speech API or OpenAI TTS |
| Turn-taking | Proprietary model | Build ourselves |
| Latency | 75ms optimized | Variable, harder to optimize |
| Tool calling | Built-in | Build ourselves |
| Cost | Per-minute pricing | Sum of individual APIs |
| Maintenance | Managed | We maintain |
| Flexibility | Constrained to their platform | Full control |

## Deliverable

Research document with:
1. Detailed capability assessment
2. Integration architecture recommendation
3. Cost estimate for landing page use case
4. Prototype plan or code snippets
5. Go/no-go recommendation with rationale
