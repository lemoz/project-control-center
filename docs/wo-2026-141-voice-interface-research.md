# WO-2026-141 Voice Q&A Interface Research

Status: Research Complete

## Scope
- Landing page only (orbital canvas + live shift context).
- Voice input for Q&A, not open-ended conversation.
- Answers based on live context + system knowledge.

## 1) Voice Input Options

| Option | Pros | Cons | Fit |
| --- | --- | --- | --- |
| Web Speech API (SpeechRecognition / webkitSpeechRecognition) | Zero backend, instant UI, no cost | Browser support is uneven (mostly Chromium), accuracy varies, privacy depends on browser vendor | Best for fast MVP with explicit fallback |
| OpenAI Whisper API | High accuracy, handles noise/accents better | Network call, cost per minute, latency | Good for quality if remote calls are acceptable |
| Deepgram / AssemblyAI (streaming) | Real-time streaming, good accuracy | Network call, cost, vendor lock | Best if live transcript is essential |
| On-device Whisper (whisper.cpp / WASM) | Strong privacy, no network | Heavy CPU, larger bundle, slower on mobile | Good for local-first privacy-focused mode |
| Hybrid (Web Speech first, Whisper fallback) | Lowest friction + quality fallback | More logic paths | Recommended path for staged rollout |

Notes:
- Browser-native recognition usually requires a user gesture (click/tap) to start.
- Mobile support is weakest on iOS Safari; plan a text input fallback.
- If ambient narration uses TTS, align voice input and output cues (same style).

## 2) Question Categories

| Category | Examples | Routing cues |
| --- | --- | --- |
| Live context | "What is happening now?" "Why is that glowing?" | Mentions "now", "glowing", "that node", "current" |
| Tutorial / How-to | "How does this work?" "What is a work order?" | "how", "what is", "explain", "work order" |
| Specific (WO/project/run) | "Tell me about WO-2026-137" "What is Project X?" | IDs (WO-), project names, run IDs |
| General / About | "What is PCC?" "Who made this?" | "what is PCC", "who", "why build this" |
| Controls / UX | "How do I zoom?" "How do I mute?" | "how do I", "mute", "pause", "zoom" |

Practical routing:
- Simple string/regex matching first (WO-*, run IDs, common phrases).
- Fallback to a lightweight classifier prompt only if needed.

## 3) Answer Generation Approach

Recommended: Hybrid context assembly + LLM with guardrails.

Pipeline:
1. Transcribe speech to text.
2. Classify question category (heuristics first, LLM fallback).
3. Assemble context by category:
   - Live context: visible nodes, focused node, active runs, shift state, recent decisions.
   - Specific: load WO/project/run details (title, goal, status, latest activity).
   - Tutorial/general: retrieve short snippets from docs and predefined answers.
4. Generate answer using a short, constrained prompt:
   - "You are a guide for PCC. Answer using the provided context only."
5. Return text + optional TTS playback.

RAG vs structured context:
- Live context answers are best as structured data + templated phrasing.
- Tutorial/general answers benefit from RAG over docs (README, system architecture, shift protocol).
- Hybrid model: prefer templates for live state, RAG for explanatory questions.

Fallback behavior:
- If context is missing or question is out-of-scope: respond with a short "I do not have that information yet" and suggest a related on-screen question.

## 4) Conversation Flow

Default: single Q&A, with optional follow-up.

Flow:
1. Idle (CTA: "Ask a question" with mic + text input).
2. Listening (visual indicator + stop button).
3. Transcribing (show interim text if available).
4. Answering (text answer + optional voice).
5. Idle again (offer "Ask follow-up" for one extra turn).

Multi-turn (optional):
- Allow one follow-up with a short context memory (last question + answer summary).
- Keep a hard stop to avoid full conversation mode.

## 5) Privacy / Permissions

Principles:
- Explicit user action to start mic capture (push-to-talk).
- Clear "listening" indicator and easy stop control.
- Do not store audio; discard after transcription.
- Store only text transcript if needed for analytics; default to off.

UX copy:
- "We only listen while you hold the mic."
- "Audio is not saved. Transcripts are optional."

## 6) Context Sources for Answers

| Source | Use |
| --- | --- |
| Shift context (active runs, decisions, status) | "What is happening now?" |
| Canvas state (focused node, visible nodes) | "Why is that glowing?" |
| Work Orders data | "What is WO-2026-137?" |
| Project metadata (.control.yml) | "What is this project about?" |
| Docs (README, system-architecture, agent_shift_protocol) | "How does this work?" |
| Metrics (run history, success rate) | "What is the success rate?" |

Notes:
- Prefer on-screen context first to keep answers grounded in what the visitor sees.
- If multiple nodes are visible, reference the focused/hovered node to reduce ambiguity.

## 7) Voice Interaction UX Sketch

```
┌────────────────────────────────────────────────────────────┐
│                         CANVAS                             │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  [Mic button] Ask a question                               │
│  [Type a question]                                         │
│                                                            │
│  State: Listening... [Stop]                                │
│  Transcript: "what is that glowing node"                   │
│                                                            │
│  You:  what is that glowing node                           │
│  PCC:  That is WO-2026-137. The agent just started it,     │
│        so it is highlighted and pulled inward.            │
│                                                            │
│  [Ask follow-up]                                           │
└────────────────────────────────────────────────────────────┘
```

State cues:
- Idle: mic icon + placeholder copy.
- Listening: pulsing ring + timer.
- Transcribing: live text.
- Answering: answer bubble + optional voice playback toggle.
- Error: short retry banner ("Could not hear that. Try again.").

## Recommendation (Phased)

Phase 1 (fastest):
- Web Speech API for transcription, explicit push-to-talk, strong text fallback.
- Heuristic question routing + templated responses for live context.

Phase 2 (quality):
- Optional Whisper API or on-device Whisper for higher accuracy.
- Lightweight RAG for tutorial/general questions.

Stop conditions:
- If privacy expectations require no network calls, skip remote STT and use on-device only.
- If voice accuracy is too low on mobile, default to text input.
