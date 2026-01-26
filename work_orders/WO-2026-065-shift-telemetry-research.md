---
id: WO-2026-065
title: Shift Telemetry Research
goal: Research and prototype expanded shift telemetry to help agents learn from predecessors.
context:
  - WO-2026-060 through 064 (Agent Shift system)
  - '"Line of agents" concept - each inherits from predecessors'
  - Question: what additional context helps future agents make better decisions?
acceptance_criteria:
  - Document what telemetry would be valuable (execution methods, tool usage patterns, time spent, etc.)
  - Prototype storage schema for expanded telemetry
  - Test with 2-3 real shifts to see what's actually useful
  - Recommend what to add vs what's noise
non_goals:
  - Full implementation (this is research)
  - UI for telemetry
  - Cross-project analysis
stop_conditions:
  - If telemetry adds complexity without clear value, recommend keeping it minimal
priority: 3
tags:
  - autonomous
  - research
  - telemetry
estimate_hours: 2
status: ready
created_at: 2026-01-11
updated_at: 2026-01-26
depends_on:
  - WO-2026-063
era: v2
---
## Research Questions

1. **Execution patterns**: Does knowing "agent ran 3 WO runs, made 12 direct edits" help the next agent?
2. **Time allocation**: Is "spent 40% on research, 60% on implementation" useful signal?
3. **Tool effectiveness**: Should we track which approaches worked vs failed?
4. **Decision history**: Beyond decisions_made in handoff, is there value in more granular decision logging?

## Potential Telemetry

```typescript
interface ShiftTelemetry {
  // Execution methods used
  wo_runs_started: number;
  wo_runs_completed: number;
  direct_edits: number;
  files_created: number;
  files_modified: number;

  // Time breakdown (if trackable)
  time_researching_ms: number;
  time_executing_ms: number;
  time_blocked_ms: number;

  // Tool usage
  tools_used: string[];  // 'runner', 'vm', 'direct', 'escalation'

  // Outcomes
  tests_run: number;
  tests_passed: number;
  builds_attempted: number;
  builds_succeeded: number;
}
```

## Evaluation Approach

1. Implement minimal telemetry capture
2. Run 2-3 real shifts with telemetry
3. Review: did any telemetry actually inform decisions?
4. Keep what's useful, drop what's noise
