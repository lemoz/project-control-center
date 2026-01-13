---
id: WO-2026-079
title: Global Agent Shift Loop
goal: Implement the global agent's autonomous loop for managing all projects.
context:
  - Same pattern as project orchestrator (context → assess → decide → act → handoff)
  - Operates on global context instead of single project
  - Primary user interaction point
acceptance_criteria:
  - Global shift lifecycle (start, context, work, handoff)
  - Decision prompt for global agent (which project needs attention, what action)
  - Actions include: delegate to project, resolve escalation, create project, user interaction
  - Global handoff captures cross-project state
  - Configurable attention allocation
non_goals:
  - Specific capabilities (health monitoring, etc.) - separate WOs
  - UI for global agent - future
stop_conditions:
  - Start simple; add sophistication incrementally
priority: 2
tags:
  - autonomous
  - global-agent
  - orchestration
estimate_hours: 5
status: done
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on:
  - WO-2026-078
era: v2
---
## Architecture

```
Global Agent Loop:

1. Gather Global Context
   └─ GET /global/context
   └─ GET /global/escalations

2. Assess & Prioritize
   └─ Which projects need attention?
   └─ Any escalations to handle?
   └─ User requests pending?

3. Decide Action
   └─ Delegate shift to project agent
   └─ Resolve escalation
   └─ Create new project
   └─ Report to user
   └─ Wait (nothing urgent)

4. Execute Action
   └─ POST /projects/:id/shifts (delegate)
   └─ POST /escalations/:id/resolve
   └─ POST /projects (create)

5. Handoff
   └─ Summarize actions taken
   └─ State of all projects
   └─ Pending items for next loop
```

## Global Decision Prompt

```
You are the Global Agent managing multiple projects.

## Projects Overview
{{#each projects}}
- {{name}}: {{health}} | {{work_orders.ready}} ready WOs | {{escalations.length}} escalations
{{/each}}

## Pending Escalations
{{#each escalation_queue}}
- [{{project_id}}] {{type}}: {{summary}}
{{/each}}

## Recent Activity
{{recent_activity_summary}}

---

Decide your next action:
1. DELEGATE - Start shift on a project (specify project_id)
2. RESOLVE - Handle an escalation (specify escalation_id + resolution)
3. CREATE_PROJECT - Spin up new project (specify details)
4. REPORT - Surface something to user (specify message)
5. WAIT - Nothing urgent, check back later

Respond with action type and parameters.
```

## Implementation

1. `server/global_agent.ts` - loop logic
2. `server/prompts/global_decision.ts` - prompt builder
3. Invoke via Claude CLI (same as project orchestrator)
4. Store global shifts/handoffs (new tables or reuse with scope flag)
