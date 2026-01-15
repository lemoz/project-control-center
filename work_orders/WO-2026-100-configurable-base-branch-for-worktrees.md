---
id: WO-2026-100
title: Configurable Base Branch for Run Worktrees
goal: Allow runs to use the project's current branch (or an explicit override) as the base for worktrees, instead of always defaulting to main/master.
context:
  - server/runner_agent.ts - resolveBaseBranch() function (lines 778-791)
  - server/db.ts - work_orders and runs table schemas
  - "Lesson learned: PCC runs created worktrees from main but target files only existed on feature/article-generation branch, causing runs to get stuck"
acceptance_criteria:
  - Add `base_branch TEXT` column to work_orders table with migration
  - Add `source_branch TEXT` column to runs table with migration
  - Update WO frontmatter schema to support optional `base_branch` field
  - Update run creation API to accept optional `source_branch` parameter
  - Modify resolveBaseBranch() to check in order: run.source_branch -> WO.base_branch -> current HEAD -> main/master
  - Update WO detail UI to show/edit base_branch field
  - Update run detail UI to show source_branch used
  - Add logging when non-default branch is selected
  - Test that run on feature branch without explicit config uses current HEAD
  - Test that explicit base_branch in WO overrides HEAD detection
  - Test that explicit source_branch on run overrides WO base_branch
non_goals:
  - Automatic branch detection based on file paths in WO
  - Branch validation (checking if branch exists before run starts)
  - Remote branch fetching
stop_conditions:
  - If HEAD detection causes issues with detached HEAD states, add explicit handling
  - If migration causes issues with existing runs, provide rollback path
priority: 2
tags:
  - runner
  - git
  - dx
  - bug-fix
estimate_hours: 4
status: done
created_at: 2026-01-13
updated_at: 2026-01-15
depends_on:
  - WO-2026-020
era: v2
---
## Overview

Currently, `resolveBaseBranch()` in `runner_agent.ts` prioritizes `main` or `master` when creating worktrees for runs:

```typescript
function resolveBaseBranch(repoPath: string, log: (line: string) => void): string {
  for (const candidate of ["main", "master"]) {
    if (gitBranchExists(repoPath, candidate)) return candidate;
  }
  // Only falls back to current branch if main/master don't exist
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {...});
  if (current && current !== "HEAD") {
    return current;
  }
  throw new Error("Unable to resolve base branch");
}
```

This causes problems when:
1. A WO targets files that only exist on a feature branch
2. The project is actively being developed on a non-main branch
3. Multiple feature branches need independent runs

## Solution

Implement a priority chain for base branch resolution:

1. **Run-level override** (`source_branch` on runs table) - Most specific, set at run creation
2. **WO-level default** (`base_branch` on work_orders table) - Applies to all runs of this WO
3. **Project current HEAD** - What branch the project is currently on
4. **Fallback to main/master** - Only if HEAD is detached or unavailable

## Database Changes

### work_orders table
```sql
ALTER TABLE work_orders ADD COLUMN base_branch TEXT;
```

### runs table
```sql
ALTER TABLE runs ADD COLUMN source_branch TEXT;
```

## Code Changes

### runner_agent.ts

Update `resolveBaseBranch()` to accept optional overrides:

```typescript
function resolveBaseBranch(
  repoPath: string,
  log: (line: string) => void,
  options?: { runSourceBranch?: string; woBaseBranch?: string }
): string {
  // 1. Explicit run-level override
  if (options?.runSourceBranch) {
    if (gitBranchExists(repoPath, options.runSourceBranch)) {
      log(`Using run source_branch: ${options.runSourceBranch}`);
      return options.runSourceBranch;
    }
    log(`Warning: run source_branch "${options.runSourceBranch}" not found, falling back`);
  }

  // 2. WO-level default
  if (options?.woBaseBranch) {
    if (gitBranchExists(repoPath, options.woBaseBranch)) {
      log(`Using WO base_branch: ${options.woBaseBranch}`);
      return options.woBaseBranch;
    }
    log(`Warning: WO base_branch "${options.woBaseBranch}" not found, falling back`);
  }

  // 3. Current HEAD (prioritized over main/master)
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
  }).stdout.trim();
  if (current && current !== "HEAD") {
    log(`Using current HEAD branch: ${current}`);
    return current;
  }

  // 4. Fallback to main/master
  for (const candidate of ["main", "master"]) {
    if (gitBranchExists(repoPath, candidate)) {
      log(`Falling back to ${candidate}`);
      return candidate;
    }
  }

  throw new Error("Unable to resolve base branch");
}
```

### Call site update (around line 2557)

```typescript
const baseBranch = resolveBaseBranch(repoPath, log, {
  runSourceBranch: run.source_branch,
  woBaseBranch: workOrder.base_branch,
});
```

### WO frontmatter parsing

Update `work_orders.ts` to parse `base_branch` from frontmatter.

### Run creation API

Update run creation endpoint to accept optional `source_branch` parameter.

## UI Changes

### Work Order Detail
- Add "Base Branch" field (optional text input) in WO edit form
- Show base_branch in WO detail view if set

### Run Detail
- Show "Source Branch" in run info panel
- Indicate if it was explicit vs auto-detected

## Testing Plan

1. **Default behavior (no config):**
   - Checkout feature branch in project
   - Create WO without base_branch
   - Start run without source_branch
   - Verify worktree created from feature branch (current HEAD)

2. **WO base_branch:**
   - Create WO with `base_branch: develop`
   - Start run
   - Verify worktree created from develop

3. **Run source_branch override:**
   - Create WO with `base_branch: develop`
   - Start run with `source_branch: feature/test`
   - Verify worktree created from feature/test (overrides WO)

4. **Missing branch handling:**
   - Create WO with `base_branch: nonexistent`
   - Start run
   - Verify warning logged and falls back to HEAD

5. **Detached HEAD:**
   - Checkout specific commit (detached)
   - Start run without config
   - Verify falls back to main/master

## Migration

```typescript
// In ensureSchema() migrations section
const hasWoBaseBranch = workOrderColumns.some((c) => c.name === "base_branch");
if (!hasWoBaseBranch) {
  db.exec("ALTER TABLE work_orders ADD COLUMN base_branch TEXT");
}

const hasRunSourceBranch = runColumns.some((c) => c.name === "source_branch");
if (!hasRunSourceBranch) {
  db.exec("ALTER TABLE runs ADD COLUMN source_branch TEXT");
}
```

## Rollback Plan

If issues arise:
1. New columns are nullable, so existing code paths still work
2. Can revert `resolveBaseBranch()` changes independently
3. UI changes are additive and can be hidden behind feature flag
