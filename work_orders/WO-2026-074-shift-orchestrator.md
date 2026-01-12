---
id: WO-2026-074
title: Shift Orchestrator
goal: Create the orchestrator that invokes Claude Code agents to take shifts on projects, with full network access via Chrome extension.
context:
  - docs/agent_shift_protocol.md (WO-2026-060)
  - WO-2026-061 (context assembly) - done
  - WO-2026-062 (handoff storage) - done
  - WO-2026-063 (shift lifecycle) - done
  - WO-2026-064 (decision prompt) - done
  - Agent is Claude Code with MCP Chrome extension for full network access
acceptance_criteria:
  - Orchestrator can start a shift on a project
  - Invokes Claude Code with shift context + decision prompt
  - Claude Code has access to MCP browser tools (full network)
  - Agent executes decision (WO run, direct action, research, etc.)
  - Shift completes with handoff stored
  - Configurable trigger modes (manual, scheduled, event-driven)
  - Per-project shift policies (enabled, frequency, max duration)
  - Logging and observability of shift execution
non_goals:
  - Multi-agent concurrent shifts (one at a time per project)
  - Cross-project coordination
  - Custom agent types (Claude Code only for now)
stop_conditions:
  - If Claude Code invocation is unreliable, start with manual trigger only
priority: 1
tags:
  - autonomous
  - orchestrator
  - claude-code
  - infrastructure
estimate_hours: 6
status: draft
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-061
  - WO-2026-062
  - WO-2026-063
  - WO-2026-064
  - WO-2026-075
era: v2
---
## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SHIFT ORCHESTRATOR                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TRIGGER                                                    │
│  ├── Manual: POST /projects/:id/shifts/start-autonomous     │
│  ├── Scheduled: Cron per project (e.g., every 4 hours)      │
│  └── Event: On WO ready, on run complete, on human review   │
│                                                             │
│  INVOKE AGENT                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ claude-code --project <path> --prompt <shift_prompt>  │  │
│  │                                                       │  │
│  │ Agent has:                                            │  │
│  │ • Full filesystem access                              │  │
│  │ • MCP Chrome extension (full network)                 │  │
│  │ • Shift context injected                              │  │
│  │ • Decision framework prompt                           │  │
│  │ • Access to WO runner, VM, direct actions             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  MONITOR                                                    │
│  ├── Track shift duration                                   │
│  ├── Capture agent output/logs                              │
│  ├── Detect completion or timeout                           │
│  └── Handle escalations                                     │
│                                                             │
│  COMPLETE                                                   │
│  ├── Agent calls shift complete API with handoff            │
│  ├── Or orchestrator force-completes on timeout             │
│  └── Log shift outcome for learning                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Trigger Modes

### Manual
```
POST /projects/:id/shifts/start-autonomous
```
User explicitly requests an autonomous shift.

### Scheduled
```typescript
interface ShiftSchedule {
  project_id: string;
  enabled: boolean;
  cron: string;           // e.g., "0 */4 * * *" (every 4 hours)
  max_duration_minutes: number;
  pause_on_failure_count: number;
}
```

### Event-Driven
- When a WO transitions to `ready` status
- When a run completes (success or failure)
- When human reviews/approves something
- Configurable per project

## Decisions

1. **Trigger mode**: Manual only for MVP. System ready for scheduled later.
2. **Shift duration**: No hard limit initially. Observe actual durations first.
3. **Constitution**: Need shift-specific constitution tailoring as we observe runs.

## Research Complete: SDK Approach

Use `@anthropic-ai/claude-agent-sdk` (see WO-2026-075):

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: shiftDecisionPrompt,
  options: {
    cwd: projectPath,
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
    permissionMode: "bypassPermissions",
    mcpServers: { "claude-in-chrome": { /* config */ } },
    maxBudgetUsd: 10.00
  }
})) {
  // Handle streaming messages
}
```

## Open Questions

1. **Chrome extension MCP config**: Exact MCP server configuration for browser tools
2. **Cost limits**: What's reasonable per-shift budget?
3. **Failure handling**: Retry? Pause? Alert?

## Implementation Phases

### Phase 1: Manual Trigger
- API endpoint to start autonomous shift
- Invoke Claude Code with context
- Basic logging and timeout

### Phase 2: Scheduled Shifts
- Shift schedule table
- Cron-like scheduler
- Per-project policies

### Phase 3: Event-Driven
- Hooks on WO status changes
- Hooks on run completion
- Smart triggering logic

## Files to Create/Modify

1. `server/shift_orchestrator.ts` (new) - Core orchestration logic
2. `server/db.ts` - Shift schedule/policy tables
3. `server/index.ts` - API endpoints
4. `server/shift_invoker.ts` (new) - Claude Code invocation
