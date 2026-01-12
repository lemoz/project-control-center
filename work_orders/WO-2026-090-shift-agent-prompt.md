---
id: WO-2026-090
title: Shift Agent Prompt & Script
goal: Create the prompt and launcher script that enables Claude CLI to run autonomous shift loops.
context:
  - WO-2026-074 defines shift agent architecture
  - Need a prompt that instructs Claude on the shift loop
  - Need a simple script to invoke with correct flags
  - This is the key piece to enable full auto testing
acceptance_criteria:
  - Shift agent prompt that instructs Claude CLI to run the loop
  - Prompt includes how to fetch context, make decisions, execute, monitor
  - Launcher script with correct CLI flags (full permissions, tools)
  - Prompt references existing endpoints (shift-context, runs, shifts)
  - Clear exit conditions (timeout, done, escalation)
  - Works with existing infrastructure (no new endpoints needed)
non_goals:
  - New server endpoints (use existing)
  - Scheduled execution (manual trigger only)
  - Multi-project support
stop_conditions:
  - If prompt is too complex, simplify to single-run-per-shift
priority: 1
tags:
  - autonomous
  - orchestrator
  - prompt
estimate_hours: 2
status: done
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-076
era: v2
---
## Deliverables

### 1. Shift Agent Prompt (`prompts/shift_agent.md`)

The prompt should instruct Claude to:

```markdown
# Shift Agent

You are the autonomous shift agent for this project. Your job is to:

1. **Start a shift** - POST to /projects/:id/shifts
2. **Gather context** - GET /projects/:id/shift-context
3. **Assess & Decide** - What needs attention? Which WO to run?
4. **Execute** - Kick off runs, monitor, handle issues
5. **Loop** - Repeat until shift timeout or nothing left to do
6. **Handoff** - Complete shift with summary

## Available Actions

- **Run a WO**: POST /repos/:id/work-orders/:woId/runs
- **Check run status**: GET /runs/:runId
- **Research**: Use browser, web search
- **Direct action**: Edit files, run commands
- **Escalate**: Ask user if stuck

## Decision Framework

Priority order:
1. Handle any in-progress runs (monitor, react to completion)
2. Resolve any blockers or escalations
3. Pick highest priority ready WO
4. If nothing ready, assess backlog or research

## Exit Conditions

- Shift timeout approaching
- All ready WOs completed
- Blocked and needs user input
- Explicit user interrupt

## Context Endpoint

GET http://localhost:4010/projects/{project_id}/shift-context

Returns: project info, WOs, runs, git state, constitution, last handoff
```

### 2. Launcher Script (`scripts/start-shift.sh`)

```bash
#!/bin/bash
PROJECT_ID="${1:-project-control-center}"
PROJECT_PATH="${2:-/Users/cdossman/project-control-center}"

claude \
  --project "$PROJECT_PATH" \
  --prompt "$(cat prompts/shift_agent.md | sed "s/{project_id}/$PROJECT_ID/g")" \
  --dangerously-skip-permissions \
  --allowedTools "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch"
```

### 3. Test Run

```bash
# From project root
./scripts/start-shift.sh project-control-center

# Claude should:
# 1. Start a shift
# 2. Fetch context
# 3. Pick a WO (e.g., one that's ready)
# 4. Kick off a run
# 5. Monitor until complete
# 6. Decide next action or complete shift
```

## Implementation Notes

- Prompt should be detailed enough for Claude to act autonomously
- Include API base URL (localhost:4010)
- Include common error handling (run failed, timeout, etc.)
- Reference constitution for style/decision guidance
