---
id: WO-2026-076
title: Auto-Generate Shift Handoffs from Run Logs
goal: Automatically generate rich handoffs by analyzing run logs with Claude when a run completes.
context:
  - WO-2026-062 (handoff storage)
  - WO-2026-063 (shift lifecycle)
  - Shifts can expire before manual handoff is created
  - Run logs contain valuable context that should be preserved
acceptance_criteria:
  - When run completes (approved/failed), trigger handoff generation
  - Gather run artifacts (builder logs, reviewer notes, diff, test results)
  - Call Claude CLI (Sonnet) to analyze logs and generate structured handoff
  - Store handoff linked to shift (if active) or as orphan handoff
  - Complete the shift automatically if still active
  - Handle case where no active shift exists (still create handoff)
non_goals:
  - Changing how runs work
  - UI for viewing generated handoffs (use existing)
  - Custom prompts per project (use standard prompt)
stop_conditions:
  - If Claude CLI invocation is unreliable, fall back to template-based handoff
priority: 2
tags:
  - autonomous
  - handoff
  - runner
estimate_hours: 3
status: done
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on:
  - WO-2026-062
  - WO-2026-063
era: v2
---
## Architecture

```
Run completes (approved/merged/failed)
           ↓
┌──────────────────────────────────────────────────┐
│           HANDOFF GENERATOR                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  1. Gather Run Artifacts                         │
│     ├── Builder output/logs                      │
│     ├── Reviewer verdict + notes                 │
│     ├── Test results summary                     │
│     ├── Git diff (files changed)                 │
│     └── Run metadata (iterations, duration)      │
│                                                  │
│  2. Call Claude CLI (Sonnet)                     │
│     claude -p "<prompt>" --output-format json    │
│                                                  │
│  3. Parse Response                               │
│     {                                            │
│       summary: "...",                            │
│       work_completed: [...],                     │
│       decisions_made: [...],                     │
│       recommendations: [...],                    │
│       blockers: [...],                           │
│       next_priorities: [...]                     │
│     }                                            │
│                                                  │
│  4. Store Handoff                                │
│     ├── Link to active shift (if exists)         │
│     └── Or create orphan handoff                 │
│                                                  │
│  5. Complete Shift (if active)                   │
│     └── Status: auto_completed                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Implementation

### Trigger Point

In `server/runner_agent.ts`, after run completes:

```typescript
// After merge or failure
await generateAndStoreHandoff(runId, projectId, outcome);
```

### Artifact Gathering

```typescript
interface RunArtifacts {
  run_id: string;
  work_order_id: string;
  work_order_title: string;
  outcome: 'approved' | 'merged' | 'failed';
  iterations: number;
  duration_minutes: number;
  builder_summary: string;
  reviewer_notes: string[];
  test_results: { passed: number; failed: number };
  files_changed: string[];
  error: string | null;
}

async function gatherRunArtifacts(runId: string): Promise<RunArtifacts> {
  // Read from run record, logs, and git diff
}
```

### Claude CLI Invocation

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function generateHandoff(artifacts: RunArtifacts): Promise<HandoffContent> {
  const prompt = buildHandoffPrompt(artifacts);

  const { stdout } = await execAsync(
    `claude -p "${escapeForShell(prompt)}" --output-format json`,
    {
      cwd: projectPath,
      timeout: 60000  // 1 min timeout
    }
  );

  return JSON.parse(stdout);
}
```

### Prompt Template

```typescript
function buildHandoffPrompt(artifacts: RunArtifacts): string {
  return `
You are generating a shift handoff for the next agent. Analyze this run and create a structured summary.

## Run Details
- Work Order: ${artifacts.work_order_id} - ${artifacts.work_order_title}
- Outcome: ${artifacts.outcome}
- Iterations: ${artifacts.iterations}
- Duration: ${artifacts.duration_minutes} minutes

## Builder Summary
${artifacts.builder_summary}

## Reviewer Notes
${artifacts.reviewer_notes.join('\n')}

## Test Results
Passed: ${artifacts.test_results.passed}, Failed: ${artifacts.test_results.failed}

## Files Changed
${artifacts.files_changed.join('\n')}

${artifacts.error ? `## Error\n${artifacts.error}` : ''}

---

Generate a handoff JSON with these fields:
- summary: 1-2 sentence summary of what was accomplished
- work_completed: Array of specific items completed
- decisions_made: Array of {decision, rationale} extracted from the logs
- recommendations: Array of suggested next steps
- blockers: Array of any issues or blockers encountered
- next_priorities: Array of WO IDs or tasks to prioritize next

Respond with only valid JSON.
`;
}
```

### Shift Completion

```typescript
async function generateAndStoreHandoff(
  runId: string,
  projectId: string,
  outcome: string
) {
  const artifacts = await gatherRunArtifacts(runId);
  const handoffContent = await generateHandoff(artifacts);

  // Check for active shift
  const activeShift = getActiveShift(projectId);

  if (activeShift) {
    // Complete shift with handoff
    const handoff = createShiftHandoff({
      project_id: projectId,
      shift_id: activeShift.id,
      ...handoffContent,
      agent_id: 'auto-handoff-generator',
      duration_minutes: artifacts.duration_minutes
    });

    updateShift(activeShift.id, {
      status: 'auto_completed',
      completed_at: new Date().toISOString(),
      handoff_id: handoff.id
    });
  } else {
    // Create orphan handoff (no active shift)
    createShiftHandoff({
      project_id: projectId,
      shift_id: null,
      ...handoffContent,
      agent_id: 'auto-handoff-generator',
      duration_minutes: artifacts.duration_minutes
    });
  }
}
```

## Files to Modify

1. `server/runner_agent.ts` - Add trigger after run completion
2. `server/handoff_generator.ts` (new) - Handoff generation logic
3. `server/db.ts` - Add 'auto_completed' status to shifts

## Fallback

If Claude CLI fails (timeout, parse error), create minimal template handoff:

```typescript
const fallbackHandoff = {
  summary: `Ran ${artifacts.work_order_id}: ${artifacts.outcome}`,
  work_completed: [artifacts.work_order_id],
  decisions_made: [],
  recommendations: [],
  blockers: artifacts.error ? [artifacts.error] : [],
  next_priorities: []
};
```
