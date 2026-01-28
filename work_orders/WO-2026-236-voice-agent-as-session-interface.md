---
id: WO-2026-236
title: Voice Agent as Session Interface
status: ready
priority: 2
tags: [voice, global-session, ux]
estimate_hours: 5
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on:
  - WO-2026-223
  - WO-2026-234
  - WO-2026-235
era: v2
---
## Goal

Voice agent becomes the primary conversational interface to the global agent session, relaying status updates and accepting commands in the context of the live portfolio canvas.

## Context

- Voice agent: `app/landing/components/VoiceWidget/useVoiceAgent.ts`
- Global session loop produces events: check_in, guidance, alert, paused, resumed, completion
- Session events API: `GET /global/sessions/{id}/events`
- Global context includes escalations, active shifts, project health per project
- Voice agent already receives canvas context via `voiceClientTools.ts`

## Acceptance Criteria

- [ ] Voice agent aware of global session state (idle, onboarding, autonomous, paused)
- [ ] During autonomous: voice agent can relay session status on request ("What's happening?")
- [ ] Voice agent surfaces escalations proactively: "PCC Cloud has a budget escalation"
- [ ] Voice agent can relay shift completions: "EngageQueue shift finished, 2 WOs merged"
- [ ] User can resolve escalations by voice: "Resolve that escalation with: increase budget"
- [ ] User can direct work by voice: "Focus on EngageQueue next" → updates priority/briefing
- [ ] Voice agent greeting adapts to session state (new user vs returning vs active session)
- [ ] Canvas nodes react to voice commands (focus, highlight) in real-time
- [ ] Without voice configured: session onboarding and control works via text chat fallback
