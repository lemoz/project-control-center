---
id: WO-2026-235
title: Voice Agent Global Scope Commands
status: you_review
priority: 2
tags:
  - voice
  - canvas
  - global
  - tools
estimate_hours: 4
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-231
  - WO-2026-223
era: v2
---
## Goal

Extend the voice agent client tools to support global-scope canvas commands so users can navigate and control the portfolio view by voice.

## Context

- Current voice tools: `app/landing/components/VoiceWidget/voiceClientTools.ts` (120 lines)
- Existing tools: `focusNode`, `highlightWorkOrder`, `toggleDetailPanel` — all project-scoped
- Canvas state sharing already sends `visibleProjects` to voice agent context
- Voice agent uses ElevenLabs WebSocket via `useVoiceAgent.ts`
- Voice requires ElevenLabs key (cloud subscription or BYOK per WO-2026-223)

## Acceptance Criteria

- [ ] `focusProject(projectId)` — pan canvas to project node
- [ ] `highlightProject(projectId)` — glow/highlight a project node
- [ ] `openProjectDetail(projectId)` — open the project detail panel
- [ ] `startShift(projectId)` — trigger shift start for a project
- [ ] `askGlobalAgent(question)` — send message to global chat thread (pauses autonomous)
- [ ] `startSession()` / `pauseSession()` — session lifecycle control via voice
- [ ] Voice agent context updated to include: global session state, escalation summaries, active shifts across projects
- [ ] Tools registered with ElevenLabs client tool schema
- [ ] All voice features gated behind voice availability check (WO-2026-223)
