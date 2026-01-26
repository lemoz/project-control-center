---
id: WO-2026-086
title: Self-Improvement & Meta Operations
goal: Enable global agent to identify improvement opportunities and communicate them to PCC project shifts for autonomous action.
context:
  - PCC manages PCC (dogfooding)
  - Global agent is facilitator, NOT command-and-control
  - Projects are autonomous - global agent communicates, doesn't dictate
  - WO-2026-144 (Unified Project Communication Model) - suggestion intent
  - Global agent identifies patterns, suggests improvements via communication system
  - Project shifts decide whether to act on suggestions
acceptance_criteria:
  - Global agent can identify improvement opportunities from patterns
  - Send "suggestion" communications to PCC project via communication system
  - Start PCC shift if needed to act on suggestions
  - Project shift autonomously decides whether to create WOs from suggestions
  - Track which improvements originated from global suggestions
  - Guardrails to prevent suggestion spam
non_goals:
  - Global agent directly creating WOs (violates project autonomy)
  - Autonomous approval of changes (user reviews)
  - Core architecture changes (surface for human decision)
stop_conditions:
  - If suggestion volume overwhelms project shifts, throttle
  - If suggestions consistently ignored, re-evaluate detection quality
priority: 4
tags:
  - autonomous
  - global-agent
  - meta
  - communication
estimate_hours: 3
status: ready
created_at: 2026-01-12
updated_at: 2026-01-26
depends_on:
  - WO-2026-080
  - WO-2026-144
era: v2
---
## Triggers for Self-Improvement Suggestions

```typescript
// Patterns that trigger suggestions to PCC project
const improvementTriggers = [
  // Same escalation type 3+ times → suggest automation
  { pattern: 'repeated_escalation', threshold: 3 },

  // Phase consistently slow → suggest optimization investigation
  { pattern: 'slow_phase', threshold: '2x_average' },

  // Manual step done repeatedly → suggest automation
  { pattern: 'repeated_manual_action', threshold: 5 },

  // Constitution override pattern → suggest constitution update
  { pattern: 'constitution_override', threshold: 3 },
];
```

## Communication Flow (Correct Architecture)

```
Global agent notices: "Escalation type X happened 5 times this week"
        ↓
Analyzes pattern, formulates suggestion
        ↓
Sends communication to PCC project:
  intent: "suggestion"
  body: "Consider automating resolution for escalation type X.
         Pattern: 5 occurrences this week.
         Suggested approach: [details]"
        ↓
Optionally starts PCC shift to process suggestion
        ↓
PCC shift agent reviews suggestion:
  - Evaluates merit
  - Decides whether to create WO
  - If yes, creates WO with tag: self_improvement, source: global_suggestion
        ↓
User reviews WO in normal flow
        ↓
Track if improvement actually reduced escalations
```

## Key Principle: Project Autonomy

The global agent does NOT:
- Create WOs directly on projects
- Command projects to do things
- Override project decisions

The global agent DOES:
- Observe patterns across all projects
- Send suggestions via communication system
- Start shifts to ensure projects have opportunity to act
- Facilitate coordination between projects

## Guardrails

1. **Rate limit suggestions** - Max N suggestions per project per day
2. **Quality threshold** - Only suggest when confidence is high
3. **Track acceptance rate** - If suggestions consistently ignored, improve detection
4. **Cooldown period** - Don't re-suggest same pattern within X days
