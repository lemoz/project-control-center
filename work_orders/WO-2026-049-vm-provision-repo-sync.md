---
id: WO-2026-049
title: VM provision should sync repo and install prerequisites
goal: Ensure VM is ready to run tasks immediately after provisioning via UI/API.
context:
  - server/vm_manager.ts (lines 743-752 - conditional repo sync)
  - server/routes.ts (provision endpoint)
  - WO-2026-027 (VM Isolation feature)
acceptance_criteria:
  - Provisioning via UI always installs prerequisites (node, git, etc.)
  - Provisioning via UI always syncs the project repo to the VM
  - VM is immediately ready to execute runs after provision completes
  - Status/progress shown during sync (not just "running")
non_goals:
  - Changing the VM lifecycle (start/stop/delete)
  - Modifying SSH connectivity
  - Changing the remote execution logic
stop_conditions:
  - None expected
priority: 2
tags:
  - vm
  - infrastructure
  - bug
estimate_hours: 2
status: you_review
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on:
  - WO-2026-027
era: v1
---
## Problem

When provisioning a VM via the UI (VMPanel "Provision" button), the VM is created successfully but is not ready to run tasks. Runs fail with:

```
remote workspace setup failed: Error: Remote command failed.
```

This is because the repo is never synced to the VM.

## Root Cause

In `server/vm_manager.ts` lines 743-752, the `ensureVmPrereqs()` and `syncVmRepo()` functions only execute when `config.repoPath` is provided:

```typescript
if (config.repoPath) {
  await ensureVmPrereqs(config.projectId);
  await syncVmRepo(config.projectId, config.repoPath);
  // ...
}
```

However, when provisioning via the UI/API, only `size` is passed - no `repoPath`. This means:
1. Prerequisites (node, git, etc.) are never installed
2. The repo is never synced to `/home/project/repo`

The VM boots successfully but has nothing on it to run.

## Solution

### Option A: Always sync during provision (Recommended)
Modify `provisionVm()` to always require and use the project's repo path:
1. The provision endpoint should derive `repoPath` from the project being provisioned
2. Remove the `if (config.repoPath)` guard - always run prereqs and sync
3. Update the API to not require `repoPath` as input since it can be derived

### Option B: Lazy sync on first run
Keep provision lightweight, but detect and sync before first run:
1. Before starting a remote run, check if repo exists on VM
2. If not, run `ensureVmPrereqs()` and `syncVmRepo()`
3. This delays the sync but makes provision faster

### Option C: Separate "Sync" action in UI
Add explicit sync button to VMPanel:
1. Provision creates the VM only
2. User must click "Sync Repo" before running
3. More explicit but worse UX

## Recommendation

**Option A** is preferred because:
- Users expect "Provision VM" to result in a working VM
- No extra steps required
- Matches mental model of "provision = ready to use"

## Files to modify

- `server/vm_manager.ts` - Remove conditional guard on repo sync, derive repoPath from project
- `server/routes.ts` - Update provision endpoint to pass project's repo path
- Possibly `app/components/VMPanel.tsx` - Show sync progress during provision

## Testing

1. Delete existing VM via UI
2. Click "Provision" on a project
3. Wait for provision to complete
4. Kick off a run - should succeed without manual intervention
