---
id: WO-2026-067
title: Retry VM sync on failure
goal: Gracefully retry VM sync operations before failing the run.
context:
  - server/runner_agent.ts (sync logic)
  - Run 031aa6a9 lost 190k tokens because single sync failure killed the run
  - Transient network issues shouldn't destroy completed work
acceptance_criteria:
  - Retry sync up to 3 times with exponential backoff before failing
  - Log each retry attempt clearly
  - Only fail run after all retries exhausted
  - Apply to both upload and download sync operations
non_goals:
  - Workspace preservation (retry should make this unnecessary)
  - Manual recovery endpoints
stop_conditions:
  - If retries cause other issues, reduce to 2 attempts
priority: 2
tags:
  - runner
  - reliability
  - bug
estimate_hours: 1
status: done
created_at: 2026-01-12
updated_at: 2026-01-12
completed_at: 2026-01-12
depends_on: []
era: v2
---

## Problem

Single sync failure = dead run, lost work:

```
[00:54:37] codex exec end exit=0
[00:54:38] Builder failed: Error: Remote download failed.
```

190k tokens of work gone from one network hiccup.

## Solution

Wrap sync operations with retry logic:

```typescript
async function syncWithRetry(operation: () => Promise<void>, name: string) {
  const MAX_RETRIES = 3;
  const BACKOFF_MS = [1000, 3000, 10000];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await operation();
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      log(`${name} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${BACKOFF_MS[attempt-1]}ms...`);
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }
}
```

Apply to:
- `syncWorktreeToVm()`
- `syncVmToWorktree()`
- Any other remote file operations

## Files to Modify

1. `server/runner_agent.ts` - Add retry wrapper, apply to sync calls
