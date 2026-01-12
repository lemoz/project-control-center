---
id: WO-2026-086
title: Self-Improvement & Meta Operations
goal: Enable global agent to improve its own processes by creating WOs on PCC itself.
context:
  - PCC manages PCC (dogfooding)
  - Repeated escalation patterns → automate them
  - Agent identifies friction → creates WO to fix it
acceptance_criteria:
  - Global agent can identify improvement opportunities
  - Create WOs on PCC project for self-improvement
  - Track effectiveness of self-improvements
  - Guardrails to prevent runaway self-modification
non_goals:
  - Autonomous approval of self-modifications (user reviews)
  - Core architecture changes (surface for human decision)
stop_conditions:
  - If self-improvement creates instability, disable and revert
priority: 4
tags:
  - autonomous
  - global-agent
  - meta
estimate_hours: 3
status: backlog
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-080
  - WO-2026-081
era: v2
---
## Triggers for Self-Improvement

```typescript
// Patterns that suggest improvement opportunities
const improvementTriggers = [
  // Same escalation type 3+ times → automate resolution
  { pattern: 'repeated_escalation', threshold: 3 },

  // Phase consistently slow → investigate optimization
  { pattern: 'slow_phase', threshold: '2x_average' },

  // Manual step done repeatedly → automate
  { pattern: 'repeated_manual_action', threshold: 5 },

  // Constitution override pattern → update constitution
  { pattern: 'constitution_override', threshold: 3 },
];
```

## Guardrails

1. **User approval required** - Self-improvement WOs go to backlog, not auto-executed
2. **Scoped changes** - Can only create WOs, not directly modify code
3. **Revert capability** - Track which WOs are self-improvements for rollback
4. **Rate limit** - Max N self-improvement WOs per week

## Flow

```
Global agent notices: "Escalation type X happened 5 times this week"
        ↓
Analyzes pattern, determines fix
        ↓
Creates WO on PCC: "Auto-resolve escalation type X"
        ↓
WO goes to backlog with tag: self_improvement
        ↓
User reviews, approves → executes normally
        ↓
Track if improvement actually reduced escalations
```
