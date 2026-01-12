---
id: WO-2026-074
title: Shift Agent (Local)
goal: Implement the shift agent that runs the autonomous shift loop locally using Claude CLI with full permissions.
context:
  - docs/agent_shift_protocol.md (WO-2026-060)
  - WO-2026-061 (context assembly) - done
  - WO-2026-062 (handoff storage) - done
  - WO-2026-063 (shift lifecycle) - done
  - WO-2026-064 (decision prompt) - done
  - Shift agent is the "brain" - runs locally with full access
  - Run system is the "hands" - executes on VM, sandboxed
acceptance_criteria:
  - Shift agent runs locally via Claude CLI
  - Agent has full permissions (filesystem, browser, network)
  - Gathers context via GET /projects/:id/shift-context
  - Makes decisions using LLM + context
  - Executes decisions (kick runs via API, research, direct actions)
  - Monitors runs and loops until shift complete
  - Completes shift with auto-generated or manual handoff
  - Handles escalations locally (can ask user directly)
non_goals:
  - Running on VM (separate WO for that)
  - Multi-agent concurrent shifts
  - Cross-project coordination (global agent's job)
  - Scheduled/event triggers (manual only for MVP)
stop_conditions:
  - If Claude CLI is unreliable, simplify to API-only actions
priority: 1
tags:
  - autonomous
  - orchestrator
  - shift
  - local
estimate_hours: 4
status: ready
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-061
  - WO-2026-062
  - WO-2026-063
  - WO-2026-064
  - WO-2026-076
era: v2
---
## Architecture

```
LOCAL (your machine)
┌─────────────────────────────────────────────────────────────────┐
│  SHIFT AGENT (Claude CLI, full permissions)                     │
│                                                                 │
│  LOOP:                                                          │
│    1. context = GET /projects/:id/shift-context                 │
│    2. decision = LLM(context + constitution + last_handoff)     │
│    3. execute(decision)                                         │
│       ├── Kick run: POST /repos/:id/work-orders/:id/runs        │
│       ├── Research: browser, web search                         │
│       ├── Direct action: edit files, run commands               │
│       └── Escalate: ask user directly                           │
│    4. monitor until next decision needed                        │
│                                                                 │
│  ON EXIT:                                                       │
│    POST /shifts/:id/complete with handoff                       │
│    (auto-generated via WO-2026-076 or manual)                   │
│                                                                 │
│  CAPABILITIES:                                                  │
│    • Full filesystem access                                     │
│    • Chrome browser (via extension)                             │
│    • Network access                                             │
│    • Can see and talk to user                                   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ triggers runs via API
                            ▼
VM (isolated)
┌─────────────────────────────────────────────────────────────────┐
│  RUN SYSTEM (sandboxed, no decisions)                           │
│                                                                 │
│  Setup → Builder → Test → Reviewer → Merge                      │
│                                                                 │
│  Reports status back via API                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Shift Agent Loop

```typescript
// Pseudocode for shift agent behavior
async function runShift(projectId: string) {
  // Start shift
  const shift = await startShift(projectId);

  while (!shift.timeout && !shift.done) {
    // 1. Gather context
    const context = await fetch(`/projects/${projectId}/shift-context`);

    // 2. Decide
    const decision = await llmDecide(context);

    // 3. Execute
    switch (decision.action) {
      case 'run_wo':
        await kickRun(decision.workOrderId);
        await monitorRun(decision.runId);
        break;
      case 'research':
        await browserResearch(decision.query);
        break;
      case 'direct_action':
        await executeAction(decision.command);
        break;
      case 'escalate':
        await askUser(decision.question);
        break;
      case 'done':
        shift.done = true;
        break;
    }
  }

  // Complete with handoff
  await completeShift(shift.id, generateHandoff());
}
```

## Invocation

```bash
# Manual trigger - user runs this
claude --project /path/to/project \
  --prompt "You are the shift agent for this project. Run a shift." \
  --allowedTools "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch,mcp__chrome__*" \
  --permission-mode full
```

Or via a simple script:
```bash
./scripts/start-shift.sh project-control-center
```

## Decision Framework

The shift agent uses the decision prompt (WO-2026-064) which considers:
- Ready WOs and their priorities
- Active/recent runs and their outcomes
- Blockers and dependencies
- Time since last human interaction
- Constitution guidelines

## Monitoring Runs

While a run executes on VM:
1. Poll `/runs/:id` for status
2. Check for escalations (waiting_for_input)
3. Review logs when available (after phase completes)
4. React to completion (success/failure)

## Files to Create

1. `scripts/start-shift.sh` - Simple launcher
2. `server/prompts/shift_agent.ts` - Full agent prompt with loop instructions
3. Update `server/shift_context.ts` if needed for agent consumption

## MVP Scope

- Manual trigger only (user runs script)
- Single project at a time
- User monitors progress (sees Claude CLI output)
- Handoff via WO-2026-076 auto-generation

## Future (separate WOs)

- Scheduled triggers
- Event-driven triggers
- VM deployment (WO-2026-089)
- Multi-project orchestration (global agent)
