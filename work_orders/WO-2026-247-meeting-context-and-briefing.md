---
id: WO-2026-247
title: Meeting context and briefing
goal: Assemble portfolio briefing before joining meetings and refresh context periodically during long meetings
context:
  - "Global context endpoint: GET /global/context"
  - "Project shift context: GET /projects/{id}/shift-context"
  - "Existing voice agent context pattern: app/landing/components/VoiceWidget/voiceClientTools.ts"
  - "Context includes: portfolio summary, project health, escalations, running shifts, budget, WO counts"
acceptance_criteria:
  - Pre-meeting briefing assembled from /global/context and injected into system prompt
  - Agent answers 'what's the status of X?' accurately for any project
  - Context refreshed every 60s during meetings
  - Agent aware of escalations, running shifts, budget
  - Context refresh doesn't interrupt active conversation
non_goals:
  - Historical meeting context or memory across meetings
stop_conditions: []
priority: 2
tags:
  - meeting-integration
  - context
estimate_hours: 2
status: done
created_at: 2026-01-29
updated_at: 2026-01-30
depends_on:
  - WO-2026-245
era: v2
---
## Notes

Status query pipeline:
```
User says "what's the status of PCC Cloud?"
  → Meeting agent calls GET /projects/pcc-cloud/shift-context directly
  → Speaks the status back (no round-trip through global session needed)
```

Context should be compact enough to fit in the LLM context window alongside conversation history.
