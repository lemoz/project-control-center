---
id: WO-2026-060
title: Agent Shift Protocol Definition
goal: Define the operating model for how autonomous agents take "shifts" to advance projects toward their goals.
context:
  - .control.yml (success_criteria, success_metrics)
  - "Projects can self-determine and self-attain their own success"
  - Current WO system is task-queue based, not goal-directed
  - Constitution system provides learning/preferences
acceptance_criteria:
  - Document defines what an Agent Shift is and why it's different from task automation
  - Clear phases defined (Context, Assess, Decide, Execute, Handoff)
  - Input specification (what context the agent receives)
  - Output specification (what the agent leaves behind)
  - Decision heuristics (how to pick what to work on given goals)
  - Examples of good shift decisions vs bad ones
  - Relationship to existing systems (WOs, runs, constitution) clarified
non_goals:
  - Implementation code (this is spec only)
  - UI for shifts
  - Scheduling/automation
stop_conditions:
  - If protocol becomes too complex, simplify to core loop only
priority: 1
tags:
  - autonomous
  - protocol
  - foundation
  - documentation
estimate_hours: 2
status: ready
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on: []
era: v2
---

## Overview

An Agent Shift is the operating model for autonomous project progress. Unlike task automation (execute predefined queue), shifts are goal-directed (understand goals, decide what helps, do it).

## Core Philosophy

From PCC success criteria:
> "Projects can self-determine and self-attain their own success"

This requires AGENCY, not just AUTOMATION:
- **Automation**: Do this predefined sequence of tasks
- **Agency**: Understand the goal, figure out what helps, do it

### The Line of Agents

Each agent taking a shift is part of a continuous line of agents all working toward the same project goals. You're not starting fresh—you're inheriting from every agent before you and setting up the agent after you.

Think of it as: "This is MY project. I've been working on it through a long line of predecessors. I know the history, I understand the goals, and I'm responsible for progress."

### Full Trust Model

Agents operate with full permissions:
- **Full network access**: Can reach any endpoint, API, or service needed
- **Full filesystem access**: No sandbox restrictions
- **Full execution rights**: Can run any tool, command, or script
- **Full action authority**: Can modify code, create files, run tests, deploy

The only safety valve is **escalation**. If blocked, confused, or facing high-risk decisions, use the existing escalation system to pause and get human input.

### Thin Brain Layer

Agent shifts are a thin decision layer on top of existing infrastructure:
- **WOs**: Identified work items (pool, not queue)
- **Runner**: Executes codex runs for substantial work
- **VM**: Available for heavy computation or isolation
- **Constitution**: Learned preferences and patterns
- **Escalation**: Existing system for blocking on humans

Don't rebuild—orchestrate what exists.

## Deliverable

Create `docs/agent_shift_protocol.md` covering:

### 1. What is an Agent Shift?
- Definition and purpose
- Difference from task queue processing
- When shifts are appropriate vs manual work

### 2. Shift Phases
```
Context → Assess → Decide → Execute → Handoff
```

#### Context Phase
- What information the agent receives
- How to interpret success_criteria
- Understanding current state vs goal state

#### Assess Phase
- Gap analysis: where are we vs where we need to be?
- Blocker identification
- Opportunity recognition

#### Decide Phase
- Decision heuristics for what to work on
- Priority signals (goals > urgency > effort)
- When to create vs execute vs research vs fix

#### Execute Phase
- **Choose your tool** based on what fits:
  - **WO + Runner**: For substantial features, multi-file changes, things that benefit from isolated execution
  - **Direct action**: Quick fixes, config changes, simple tasks—just do it
  - **VM**: Heavy computation, testing, or when isolation is valuable
- Quality bar and verification
- When to stop and escalate

#### Handoff Phase
- What to leave behind
- Status updates
- Recommendations for next shift
- Blockers and context for humans

### 3. Decision Framework
How an agent reasons about "what's highest leverage right now?":
- Does it move toward success_criteria?
- Is something blocking progress that should be fixed first?
- Is there a ready WO that aligns with goals?
- Is something missing that should become a WO?
- Should I research/learn before acting?

### 4. Relationship to Existing Systems
- WOs: Pool of identified potential work (not a mandatory queue)
- Runs: Execution records, learn from failures
- Constitution: Preferences and learnings to apply
- Success criteria: The north star for decisions

### 5. Examples
Good shift decision:
> "Success criteria says 'manage 10-100 projects'. Currently at 1. The agent shift system is blocking this. I'll work on WO-2026-060 to define the protocol."

Bad shift decision:
> "WO-2026-007 (iMessage notifier) is in backlog. I'll work on that." (Doesn't connect to current goals)

### 6. Guardrails
- Must pass tests before merging
- Escalate architectural decisions to human
- Don't exceed shift scope (time or task bound)
- Always leave handoff notes
