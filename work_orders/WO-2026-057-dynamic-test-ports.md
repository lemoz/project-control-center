---
id: WO-2026-057
title: Dynamic test port allocation for parallel runs
goal: Assign unique ports per run so multiple runs can execute tests in parallel on the same VM.
context:
  - scripts/test-e2e.mjs (E2E_API_PORT, E2E_WEB_PORT, E2E_OFFLINE_WEB_PORT env vars)
  - server/runner_agent.ts (runRemoteTests, remoteExec calls)
  - "Incident: 3 parallel runs on 2GB VM caused WO-2026-056 to timeout due to resource contention"
  - Bigger VM solves resource contention but port conflicts remain
acceptance_criteria:
  - Each run gets unique port assignments (e.g., base + offset derived from runId)
  - Ports passed as env vars when invoking npm test on VM
  - No port conflicts when multiple runs reach test phase simultaneously
  - Port range stays within safe bounds (e.g., 3000-4999)
non_goals:
  - Port reuse/pooling optimization
  - Automatic port conflict detection/retry
  - Changes to local (non-VM) test execution
stop_conditions:
  - If port env vars aren't respected by test harness, fix that first
priority: 2
tags:
  - runner
  - infra
  - testing
  - parallel
estimate_hours: 1
status: done
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on: []
era: v1
---
## Problem

When multiple runs execute on the same VM, they compete for hardcoded test ports:
- `E2E_WEB_PORT: 3012`
- `E2E_OFFLINE_WEB_PORT: 3013`
- `E2E_API_PORT: 4011`

If two runs reach the test phase simultaneously, one fails with port binding errors.

## Solution

Assign unique ports per run using an offset derived from the runId:

```typescript
function getPortOffset(runId: string): number {
  // Use first 4 hex chars of runId as offset (0-65535), modulo 100 for reasonable range
  const hash = parseInt(runId.slice(0, 4), 16);
  return (hash % 90) * 10; // 0, 10, 20, ... 890
}

// Example for runId "94900adb-..."
// offset = (0x9490 % 90) * 10 = 380
// E2E_WEB_PORT = 3012 + 380 = 3392
// E2E_OFFLINE_WEB_PORT = 3013 + 380 = 3393
// E2E_API_PORT = 4011 + 380 = 4391
```

Pass these as env vars when invoking tests:

```typescript
await remoteExec(projectId, "npm test", {
  cwd: workspacePath,
  env: {
    E2E_WEB_PORT: String(3012 + offset),
    E2E_OFFLINE_WEB_PORT: String(3013 + offset),
    E2E_API_PORT: String(4011 + offset),
  },
});
```

## Files to Modify

- `server/runner_agent.ts` - Add port offset calculation and pass env vars to test commands
