---
id: WO-2026-151
title: Shift Agent Spawn Endpoint
goal: Add an API endpoint that actually spawns a shift agent process, not just creates the database record.
context:
  - Current POST /projects/:id/shifts only creates DB record
  - Actual agent execution requires running scripts/start-shift.sh manually
  - For remote/API-driven orchestration, need programmatic agent spawning
  - Should work with claude_cli agent type initially
acceptance_criteria:
  - POST /projects/:id/shifts/spawn endpoint that creates shift AND starts agent process
  - Agent process runs in background (detached)
  - Returns shift ID and process info (pid or task ID)
  - Respects existing active shift (don't double-spawn)
  - Agent uses shift-context to decide what WO to work on
  - Logs agent output to .system/shifts/{shift_id}/agent.log
  - Timeout handling (shift timeout_minutes respected)
  - GET /projects/:id/shifts/:id/logs endpoint to tail agent output
non_goals:
  - VM isolation for shift agents (separate infrastructure)
  - Multiple concurrent agents per project
  - Agent type selection beyond claude_cli
stop_conditions:
  - If spawning claude CLI programmatically is unreliable, document alternatives
  - Keep simple - this is for dev/testing, not production orchestration
priority: 2
tags:
  - api
  - shifts
  - autonomous
  - infrastructure
estimate_hours: 3
status: done
created_at: 2026-01-22
updated_at: 2026-01-23
depends_on: []
era: v2
---
## Current State

```
POST /projects/:id/shifts
  -> Creates shift record in DB
  -> Returns shift object
  -> Agent does NOT start

scripts/start-shift.sh
  -> Actually spawns claude CLI with shift prompt
  -> Runs interactively or in tmux
```

## Proposed Endpoint

```
POST /projects/:id/shifts/spawn
  Body: { timeout_minutes?: number }

  1. Check for existing active shift
     - If active, return 409 Conflict with existing shift
  2. Create new shift record
  3. Spawn agent process (detached)
     - claude -p "$(cat prompts/shift_agent.md)" --project {path}
     - Redirect output to .system/shifts/{shift_id}/agent.log
  4. Return { shift, pid, log_path }
```

## Agent Spawning

```typescript
import { spawn } from 'child_process';

function spawnShiftAgent(projectPath: string, shiftId: string): number {
  const logPath = `.system/shifts/${shiftId}/agent.log`;
  const logStream = fs.createWriteStream(logPath);

  const child = spawn('claude', [
    '-p', fs.readFileSync('prompts/shift_agent.md', 'utf-8'),
    '--project', projectPath,
    '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch'
  ], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    cwd: projectPath,
    env: { ...process.env, PCC_SHIFT_ID: shiftId }
  });

  child.unref();
  return child.pid;
}
```

## Log Tailing

```
GET /projects/:id/shifts/:shiftId/logs?tail=100
  -> Returns last N lines of agent.log
  -> Useful for monitoring progress
```

## Safety

- One active shift per project (enforced)
- Timeout kills agent process if exceeded
- Agent can call PCC API to complete shift with handoff
