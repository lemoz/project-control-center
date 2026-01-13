---
id: WO-2026-106
title: Research and Plan pnpm Workspace Support
status: you_review
priority: 1
tags:
  - runner
  - research
  - pnpm
  - monorepo
depends_on: []
goal: Thoroughly research the pnpm workspace symlink issue and produce a detailed implementation plan
acceptance_criteria:
  - Document exactly how pnpm workspaces structure node_modules
  - Identify all locations in runner_agent.ts that assume single node_modules
  - Test with real pnpm workspace projects (doittogether, others)
  - Produce a detailed plan covering detection, symlinking, and edge cases
  - Plan should address: detection of pnpm vs npm vs yarn, workspace package discovery, symlink strategy
  - No code changes - research and plan only
non_goals:
  - Actually implementing the fix (separate WO after plan approved)
  - Supporting yarn workspaces (focus on pnpm first)
  - Changing how worktrees are created fundamentally
stop_conditions:
  - If pnpm workspace detection is unreliable, document alternatives
  - If the fix is trivial (<20 lines), just include implementation in this WO
updated_at: 2026-01-13
---
## Context

The doittogether project is a pnpm monorepo that fails baseline tests when run through Control Center. The shift agent diagnosed the issue:

> Control Center's `ensureNodeModulesSymlink` only handles root node_modules, not pnpm workspace packages. For pnpm workspaces, each package also needs its node_modules symlinked for binaries like vitest to work.

**Affected code:** `server/runner_agent.ts:912-917`

**Affected projects:** doittogether (confirmed), potentially others with pnpm workspaces

## Research Questions

1. **How does pnpm structure node_modules in workspaces?**
   - Where are binaries installed? (root .bin vs package .bin)
   - What gets symlinked where?
   - How does `pnpm-workspace.yaml` define packages?

2. **What does the current `ensureNodeModulesSymlink` do?**
   - Read the function thoroughly
   - Understand what it symlinks and why
   - Identify assumptions about project structure

3. **What needs to change?**
   - Should we symlink all workspace package node_modules?
   - Or just the ones with binaries?
   - How do we detect workspace packages reliably?

4. **Edge cases to consider:**
   - Nested workspaces
   - Packages without node_modules
   - Mixed npm/pnpm projects
   - Projects that switch package managers

5. **Detection strategy:**
   - Check for pnpm-lock.yaml? pnpm-workspace.yaml?
   - Parse workspace config to find packages?
   - Or just glob for */node_modules patterns?

## Deliverable

A detailed implementation plan in this WO file (update the Implementation Plan section below) that includes:
- Exact code changes needed
- Detection logic
- Symlink strategy
- Test plan
- Rollout considerations

---

## Implementation Plan

### 1) Findings: pnpm workspace node_modules layout (real repos)
doittogether (pnpm workspace)
- `pnpm-workspace.yaml` packages: `apps/*`, `packages/*`
- Root `node_modules` contains `.pnpm`, `.modules.yaml`, `.bin`
- Workspace package `apps/web/node_modules` exists and includes `.bin` (ex: `next`, `tsc`)
- Dependency symlink example: `apps/web/node_modules/react -> ../../../node_modules/.pnpm/react@18.2.0/node_modules/react`
- Workspace package symlink example: `apps/web/node_modules/@dit/db -> ../../../../packages/db`
- Root `package.json` includes `packageManager: pnpm@...`

LLL (pnpm workspace)
- `pnpm-workspace.yaml` packages: `backend`, `frontend`, `infrastructure`
- Root `node_modules` contains `.pnpm`, `.modules.yaml`, `.bin`
- Workspace package `backend/node_modules` exists and includes `.bin` (ex: `tsx`, `prisma`)
- Dependency symlink example: `backend/node_modules/fastify -> ../../node_modules/.pnpm/fastify@5.6.1/node_modules/fastify`
- Root `package.json` has no `packageManager` field (lockfile + workspace file required for detection)

Observations
- Package-level `node_modules/.bin` exists and is required for package scripts; root `.bin` does not cover all package bins.
- Package-level dependencies are symlinks into the root `.pnpm` store.
- Workspace package symlinks point to repo package paths, so worktree symlinks should preserve correct resolution.

### 2) Runner locations that assume a single node_modules
- `IGNORE_DIRS` includes `node_modules` (repo scans/copies). `server/runner_agent.ts:72`.
- `spawnRunWorker` resolves `node_modules/.bin/tsx` at repo root. `server/runner_agent.ts:384` and `server/runner_agent.ts:403`.
- `ensureNodeModulesSymlink` only links root `node_modules`. `server/runner_agent.ts:912-917`.

### 3) Research validation (commands run)
doittogether
- `ls -a /Users/cdossman/doittogether/node_modules | head -n 40` -> includes `.pnpm`, `.modules.yaml`, `.bin`
- `ls -a /Users/cdossman/doittogether/apps/web/node_modules | head -n 40` -> includes `.bin` and package folders
- `ls -l /Users/cdossman/doittogether/apps/web/node_modules/react` -> symlink into root `.pnpm` store
- `ls -l /Users/cdossman/doittogether/apps/web/node_modules/@dit` -> workspace package symlinks to `packages/*`

LLL
- `ls -a /Users/cdossman/LLL/node_modules | head -n 40` -> includes `.pnpm`, `.modules.yaml`, `.bin`
- `ls -a /Users/cdossman/LLL/backend/node_modules | head -n 40` -> includes `.bin` and package folders
- `ls -l /Users/cdossman/LLL/backend/node_modules/fastify` -> symlink into root `.pnpm` store
- `ls -a /Users/cdossman/LLL/backend/node_modules/.bin | head -n 20` -> includes `tsx`, `prisma`, `tsc`

### 4) Package manager detection (pnpm vs npm vs yarn)
- Prefer `package.json#packageManager` when present.
- Fallback to lockfiles at repo root (order):
  1. `pnpm-lock.yaml`
  2. `package-lock.json` or `npm-shrinkwrap.json`
  3. `yarn.lock`
- If multiple lockfiles exist, prefer `packageManager`; otherwise prefer pnpm when `pnpm-workspace.yaml` exists and log ambiguity.
- Output: `pnpm`, `npm`, `yarn`, `unknown`.

### 5) Workspace discovery (pnpm only)
- If package manager is not `pnpm`, keep current behavior (root node_modules only).
- If `pnpm-workspace.yaml` exists:
  - Parse with `yaml` (already imported).
  - Read `packages` array; ignore if missing/empty.
  - Expand glob patterns to package directories.
    - Preferred: add `fast-glob` and use `cwd=repoPath`, `onlyDirectories=true`, include negative globs directly.
    - Alternative: implement minimal globbing for `*` and `**` with exclusion handling (higher risk).
  - Filter to directories containing `package.json`.
  - Normalize to relative paths, dedupe, sort.
  - Guard: resolved path must stay under repo root.

### 6) Symlink strategy
- Keep existing root `node_modules` symlink.
- For each workspace package directory:
  - If `<repo>/<pkg>/node_modules` exists (dir or symlink), `safeSymlink` it to `<worktree>/<pkg>/node_modules`.
  - Skip missing package `node_modules` without error; log linked vs skipped counts.
- If workspace package symlinks resolve to repo paths (not worktree) and cause test failures, fallback option:
  - Run `pnpm install -w --frozen-lockfile --prefer-offline` inside the worktree (only when pnpm is available).

### 7) Exact code changes (future implementation)
- `server/runner_agent.ts`:
  - Add helpers near `ensureNodeModulesSymlink`:
    - `detectPackageManager(repoPath): "pnpm" | "npm" | "yarn" | "unknown"`
    - `readPnpmWorkspaceGlobs(repoPath): string[]`
    - `listWorkspacePackageDirs(repoPath): string[]`
  - Update `ensureNodeModulesSymlink` to:
    - Always link root `node_modules`.
    - If pnpm workspace detected, link each package `node_modules`.
  - Add logging for detection and symlink counts.
- `package.json` and lockfile:
  - If using `fast-glob`, add dependency and update lockfile.

### 8) Edge cases
- `pnpm-workspace.yaml` missing or empty packages list.
- Workspaces with nested globs or exclusions.
- Packages without `node_modules` (no install yet).
- Mixed lockfiles (ambiguous package manager).
- `node-linker=hoisted` or hoisted bins (package `node_modules` may be sparse).

### 9) Test plan (post-implementation)
- doittogether:
  - Run a Control Center run after change; confirm baseline tests pass.
  - Verify `worktree/apps/*/node_modules` symlinks exist.
  - Run repo tests (`pnpm -r test`) and confirm binaries like `next`/`vitest` resolve via package `.bin`.
- LLL (second pnpm workspace):
  - Repeat symlink verification and run `pnpm -r test -- --run` (or repo test script).
- If symlinked workspace packages resolve to repo paths and break tests, evaluate pnpm-install fallback.

### 10) Rollout considerations
- Scope to pnpm workspaces only; npm/yarn behavior unchanged.
- Log detection and symlink counts for troubleshooting.
- Optional env toggle (ex: `CONTROL_CENTER_PNPM_WORKSPACE_SYMLINK=0`) to disable during rollout.
