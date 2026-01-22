---
id: WO-2026-141
title: Voice Q&A Interface Research
goal: Explore adding voice input for visitors to ask questions about what they're seeing on the landing page canvas.
context:
  - Landing page shows live agent shift + orbital canvas
  - Ambient narration describes what's happening (WO-2026-139)
  - Want visitors to ask questions via voice
  - Example questions - What is happening, Why that project, How does this work
  - Answers come from live context + system knowledge
acceptance_criteria:
  - Survey voice input options (Web Speech API, Whisper, etc.)
  - Define question categories (live context, tutorial, general)
  - Propose answer generation approach (RAG, live context, hybrid)
  - Consider conversation flow (single Q&A vs multi-turn)
  - Address privacy/permissions (mic access)
  - Identify context sources for answer generation
  - Sketch voice interaction UX
non_goals:
  - Implementation
  - Deep NLU/intent classification
  - Full conversational agent
stop_conditions:
  - Focus on Q&A, not general conversation
  - Keep scope to landing page context
priority: 3
tags:
  - research
  - ui
  - voice
  - ux
estimate_hours: 2
status: parked
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Research Questions

1. **Voice Input Options**:
   - Web Speech API (free, browser-native, variable accuracy)
   - OpenAI Whisper API (accurate, cost per minute)
   - Deepgram (real-time, cost)
   - AssemblyAI (accurate, cost)
   - On-device Whisper (privacy, latency)

2. **Question Categories**:
   - **Live context**: "What's happening now?" "Why is that glowing?"
   - **Tutorial**: "How does this work?" "What is a work order?"
   - **Specific**: "Tell me about WO-2026-137" "What's the success rate?"
   - **General**: "What is PCC?" "Who made this?"

3. **Answer Generation**:
   - **Live context**: Pull from shift context, runs, WO data
   - **Tutorial**: Pre-written or RAG from docs
   - **Hybrid**: LLM with live context + system knowledge injected

4. **Conversation Model**:
   - Single Q&A (ask, get answer, done)
   - Multi-turn (follow-ups, clarification)
   - Hybrid (single Q&A default, can follow up)

5. **Privacy/Permissions**:
   - Mic permission prompt (browser native)
   - Clear indicator when listening
   - Option to use text instead
   - No audio stored (process and discard)

## Voice Interaction UX

```
┌─────────────────────────────────────────────────────────────┐
│                        CANVAS                               │
│                                                             │
│                    [orbital view]                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │  🎤  "Ask me anything..."                         │     │
│   │      [Click to speak] or [Type a question]        │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │  🎙️ Listening...                                  │     │
│   │  ████████░░░░░░░░░░░░░░░░░░                       │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ┌───────────────────────────────────────────────────┐     │
│   │  You: "What is that glowing node?"                │     │
│   │                                                   │     │
│   │  🔊 That's WO-2026-137, a research task about    │     │
│   │     project communication. The agent just        │     │
│   │     started working on it, which is why it's     │     │
│   │     glowing and pulled toward the center...      │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Context Sources for Answers

| Question Type | Data Sources |
|---------------|--------------|
| "What's happening?" | Active runs, recent decisions, shift state |
| "What is WO-X?" | WO title, goal, status, acceptance criteria |
| "Why is X glowing?" | Run status, activity level, escalations |
| "What's the success rate?" | Metrics from .control.yml, run history |
| "How does this work?" | Docs, pre-written explanations |
| "What is PCC?" | About content, .control.yml goals |

## Answer Generation Flow

```
Voice Input
    │
    ▼
Transcription (Whisper/Web Speech)
    │
    ▼
Context Assembly:
  - Current canvas state (focused node, visible nodes)
  - Shift context (active runs, decisions)
  - WO details (if specific WO mentioned)
  - System docs (for tutorial questions)
    │
    ▼
LLM Prompt:
  "You are a guide for PCC. Answer the visitor's question
   using the following context: {context}
   Question: {transcribed_question}"
    │
    ▼
TTS Response (same voice as ambient narration)
```

## Open Questions

1. Push-to-talk vs wake word vs always listening?
2. How to handle accent/noise issues gracefully?
3. Should text input be equally prominent?
4. Multi-language support? (future)
5. What if the question is about something not on screen?
