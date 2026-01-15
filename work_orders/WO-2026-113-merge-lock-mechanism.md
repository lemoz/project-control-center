---
id: WO-2026-113
title: Merge Lock Mechanism for Concurrent Runs
goal: Prevent concurrent merge conflicts by serializing merge operations per project using a database lock, and clean up stale repo state before merging.
context:
  - server/runner_agent.ts - merge section around line 4200+
  - server/db.ts - database tables and functions
  - "Lesson learned: Multiple runs completing at same time cause merge conflicts due to race conditions on main branch"
  - "Lesson learned: Crashed runs can leave main repo in dirty state causing subsequent merges to fail"
acceptance_criteria:
  - Add `merge_locks` table to db.ts with project_id, run_id, acquired_at columns
  - Add `acquireMergeLock(projectId, runId)` function that returns true if lock acquired
  - Add `releaseMergeLock(projectId, runId)` function to release the lock
  - Add stale lock cleanup (locks older than 10 minutes auto-expire)
  - Update runner_agent.ts merge section to acquire lock before merging
  - Wait with polling (2s interval, 5min timeout) if lock held by another run
  - Release lock in finally block to ensure cleanup on success/failure/error
  - Clean up main repo state (reset, clean, abort merge) before merge operations
  - Add logging for lock acquisition, waiting, and release
  - Test that concurrent runs queue properly instead of conflicting
non_goals:
  - Priority-based queue ordering (FIFO is sufficient)
  - Distributed locking (SQLite is single-process safe)
  - UI for viewing lock status
stop_conditions:
  - If lock wait causes runs to timeout frequently, reduce timeout or add user notification
  - If SQLite locking causes deadlocks, switch to file-based locking
priority: 1
tags:
  - runner
  - git
  - bug-fix
  - parallelism
estimate_hours: 3
status: ready
created_at: 2026-01-15
updated_at: 2026-01-15
depends_on:
  - WO-2026-020
era: v2
---
## Overview

Currently, when multiple runs complete review around the same time, they race to merge into main. This causes:
1. Merge conflicts even when changes don't overlap
2. Main repo left in dirty state from failed/crashed runs
3. Subsequent runs failing with "uncommitted changes" errors

## Solution

### 1. Database Lock Table

```sql
CREATE TABLE IF NOT EXISTS merge_locks (
  project_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### 2. Lock Functions in db.ts

```typescript
export function acquireMergeLock(projectId: string, runId: string): boolean {
  // Clean stale locks (>10 min old)
  // Try INSERT - succeeds if no existing lock
  // Returns true if acquired, false if held by another run
}

export function releaseMergeLock(projectId: string, runId: string): void {
  // DELETE WHERE project_id = ? AND run_id = ?
}

export function getMergeLock(projectId: string): MergeLock | null {
  // Return current lock holder info
}
```

### 3. Runner Agent Changes

Before merge operations:
```typescript
// Acquire lock with polling
const lockTimeoutMs = 5 * 60 * 1000;
const lockPollMs = 2000;
while (!acquireMergeLock(projectId, runId)) {
  if (elapsed > lockTimeoutMs) {
    // Mark as conflict with lock timeout error
    return;
  }
  log("Waiting for merge lock...");
  await sleep(lockPollMs);
}

try {
  // Clean up main repo state
  const status = runGit(["status", "--porcelain"], { cwd: repoPath });
  if (status.stdout.trim()) {
    runGit(["reset", "--hard", "HEAD"], { cwd: repoPath });
    runGit(["clean", "-fd"], { cwd: repoPath });
    runGit(["merge", "--abort"], { cwd: repoPath, allowFailure: true });
  }

  // ... existing merge logic ...
} finally {
  releaseMergeLock(projectId, runId);
}
```

## Testing Plan

1. **Lock acquisition**: Start two runs, verify second waits for first
2. **Lock release on success**: Verify lock released after successful merge
3. **Lock release on failure**: Verify lock released after merge conflict
4. **Lock release on error**: Verify lock released after unhandled error
5. **Stale lock cleanup**: Create old lock, verify new run can acquire
6. **Main repo cleanup**: Dirty main repo state is cleaned before merge

## Rollback Plan

Lock table and functions are additive - can remove lock calls from runner_agent.ts to revert to previous behavior without dropping table.
