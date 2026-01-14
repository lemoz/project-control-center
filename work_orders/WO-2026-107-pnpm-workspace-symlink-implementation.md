---
id: WO-2026-107
title: Implement pnpm Workspace Symlink Support
goal: Fix runner to properly symlink workspace package node_modules for pnpm monorepos
context:
  - WO-2026-106 (research completed)
  - doittogether and LLL are blocked until this is fixed
  - Current ensureNodeModulesSymlink only links root node_modules
  - pnpm workspaces have package-level node_modules/.bin needed for scripts
acceptance_criteria:
  - Add detectPackageManager(repoPath) function returning pnpm|npm|yarn|unknown
  - Add listWorkspacePackageDirs(repoPath) that parses pnpm-workspace.yaml and expands globs
  - Update ensureNodeModulesSymlink to also link each workspace package node_modules when pnpm detected
  - Add fast-glob dependency for glob expansion
  - Log package manager detection and symlink counts
  - doittogether baseline tests pass after change
  - Existing npm/yarn repos unchanged (no regression)
non_goals:
  - Yarn workspaces support (future WO)
  - npm workspaces support (future WO)
  - Running pnpm install in worktree (fallback only if symlinks fail)
  - Hoisted node-linker edge cases (defer unless blocking)
stop_conditions:
  - If fast-glob causes issues, implement minimal glob matching instead
priority: 1
tags:
  - runner
  - pnpm
  - monorepo
  - fix
  - unblocks-projects
estimate_hours: 3
status: building
created_at: 2026-01-14
updated_at: 2026-01-14
depends_on:
  - WO-2026-106
era: v2
---
## Implementation Details

Based on WO-2026-106 research findings:

### Code Changes (server/runner_agent.ts)

1. **detectPackageManager(repoPath)**
   - Check `package.json#packageManager` first
   - Fallback to lockfiles: `pnpm-lock.yaml` → `package-lock.json` → `yarn.lock`
   - Return: `pnpm | npm | yarn | unknown`

2. **listWorkspacePackageDirs(repoPath)**
   - If not pnpm, return empty array
   - Parse `pnpm-workspace.yaml` with existing yaml import
   - Expand `packages` globs using fast-glob
   - Filter to dirs containing package.json
   - Guard: resolved paths must stay under repo root

3. **Update ensureNodeModulesSymlink**
   - Always link root `node_modules` (existing)
   - If pnpm workspace detected:
     - Get workspace package dirs
     - For each, symlink `<repo>/<pkg>/node_modules` → `<worktree>/<pkg>/node_modules`
     - Skip missing package node_modules without error
   - Log: "Detected pnpm workspace with N packages, linked M node_modules"

### Dependencies

Add to package.json:
```json
"fast-glob": "^3.3.0"
```

### Test Plan

1. Run doittogether through Control Center
2. Verify baseline tests pass
3. Verify `worktree/apps/*/node_modules` symlinks exist
4. Run PCC tests to confirm no npm regression
