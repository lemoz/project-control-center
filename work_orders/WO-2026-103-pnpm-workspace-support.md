---
id: WO-2026-103
title: Research and Plan pnpm Workspace Support
status: ready
priority: 1
tags: [runner, research, pnpm, monorepo]
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

_To be filled in by research agent_
