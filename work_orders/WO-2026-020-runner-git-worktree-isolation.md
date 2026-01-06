---
id: WO-2026-020
title: Runner Git Worktree Isolation with Conflict Resolution
goal: Isolate each builder run in its own git branch/worktree so parallel runs don't overwrite each other, with intelligent conflict resolution when merging back to main.
context:
  - server/runner_agent.ts (current runner implementation)
  - server/db.ts (run tracking)
  - .system/runs/ (run artifacts storage)
acceptance_criteria:
  - Each run creates a dedicated branch (e.g., `run/WO-2026-016-{shortId}`) and works in a git worktree under `.system/runs/{id}/worktree/`.
  - Builder agent runs with `cwd` set to the worktree, completely isolated from main branch.
  - On approval, the system attempts a clean merge to main.
  - If merge conflict occurs, the builder is given context from the conflicting run(s) - work order, diff, summary - and attempts to resolve.
  - If auto-resolution fails, run status becomes `merge_conflict` with details for human review.
  - Worktree and branch are cleaned up after successful merge or manual resolution.
  - Run artifacts (diff.patch, work_order.md, etc.) continue to be stored in `.system/runs/{id}/` for context reconstruction.
non_goals:
  - Live real-time chat between concurrent builders (async context sharing is sufficient).
  - Automatic priority-based conflict winners (human decides in ambiguous cases).
  - CI/CD integration for branch testing (future work order).
stop_conditions:
  - If worktree creation adds significant overhead (>5s), investigate lightweight alternatives.
  - If git operations cause repo corruption in testing, stop and reassess approach.
priority: 1
tags:
  - runner
  - git
  - parallelism
  - autonomous
estimate_hours: 8
status: done
created_at: 2026-01-05
updated_at: 2026-01-06
depends_on:
  - WO-2025-004
era: autonomous
---
## Overview

Currently, the builder runs directly in the main working directory (`cwd: repoPath`), which means:
1. Changes are applied immediately, before approval
2. Concurrent runs (or manual edits) can overwrite each other
3. No isolation between parallel work

This work order introduces git worktree-based isolation so each run operates on its own branch.

## Architecture

```
Run starts
    │
    ├─► Create branch: run/WO-XXXX-{shortId}
    │
    ├─► Create worktree: .system/runs/{id}/worktree/
    │   (git worktree add .system/runs/{id}/worktree run/WO-XXXX-{shortId})
    │
    ├─► Builder runs in worktree (isolated)
    │   - cwd: .system/runs/{id}/worktree/
    │   - All file changes contained in branch
    │
    ├─► Reviewer approves
    │
    ├─► Attempt merge to main
    │   │
    │   ├─► Clean merge? ─► Done, cleanup worktree/branch
    │   │
    │   └─► Conflict? ─► Load conflicting run context
    │                    ─► Builder attempts resolution
    │                    ─► Re-run reviewer on resolution
    │                    ─► Still failing? status="merge_conflict"
    │
    └─► Cleanup: git worktree remove, git branch -d
```

## Conflict Resolution Context

When a conflict occurs, reconstruct context from `.system/runs/`:

```typescript
type ConflictContext = {
  currentRun: {
    id: string;
    workOrder: WorkOrder;
    diff: string;
    builderSummary: string;
  };
  conflictingRun: {
    id: string;
    workOrder: WorkOrder;
    diff: string;
    builderSummary: string;
    mergedAt: string; // when it merged to main
  };
  conflictFiles: string[];
  gitConflictOutput: string; // raw conflict markers
};
```

The builder prompt for conflict resolution:

```
You are resolving a merge conflict.

Your run (WO-2026-020): [summary of what you changed and why]
Conflicting run (WO-2026-016): [summary of what they changed and why]

Conflicting files: [list]

Your task:
- Understand both intents
- Resolve the conflict preserving both goals where possible
- If goals are mutually exclusive, preserve the higher-priority work order's intent
- Document your resolution reasoning
```

## Database Changes

Add to `runs` table:
- `branch_name TEXT` - the git branch for this run
- `merge_status TEXT` - null | "pending" | "merged" | "conflict"
- `conflict_with_run_id TEXT` - if conflict, which run caused it

## Key Implementation Points

1. **Worktree lifecycle:**
   ```bash
   # Create
   git worktree add .system/runs/{id}/worktree -b run/WO-XXXX-{shortId}

   # Cleanup
   git worktree remove .system/runs/{id}/worktree
   git branch -d run/WO-XXXX-{shortId}
   ```

2. **Merge attempt:**
   ```bash
   git checkout main
   git merge run/WO-XXXX-{shortId} --no-ff -m "Merge WO-XXXX: {title}"
   ```

3. **Conflict detection:**
   - If merge fails with conflicts, parse `git diff --name-only --diff-filter=U`
   - Look up which run last modified those files (from `files_changed.json`)

4. **Node modules handling:**
   - Worktree shares `.git` but needs its own `node_modules`
   - Option A: Symlink `node_modules` from main
   - Option B: Run `npm ci` in worktree (slower but safer)
   - Start with symlink, add flag for fresh install if needed

## Testing Plan

1. **Unit tests:**
   - Worktree create/cleanup functions
   - Conflict context reconstruction
   - Merge status state machine

2. **Integration tests:**
   - Two runs modifying different files → both merge cleanly
   - Two runs modifying same file, no overlap → auto-merge works
   - Two runs modifying same lines → conflict detected, context loaded
   - Conflict resolution → reviewer validates → merge succeeds

## Rollback Plan

If worktree approach causes issues:
1. Keep existing direct-to-repo code path behind a flag
2. `runner.useWorktree: boolean` in settings
3. Default to worktree, fallback available

## Future Enhancements (Out of Scope)

- Per-branch CI testing before merge
- Parallel run queue visualization in UI
- Conflict resolution UI for humans
- Branch protection rules integration
