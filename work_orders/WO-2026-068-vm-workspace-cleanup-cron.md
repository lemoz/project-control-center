---
id: WO-2026-068
title: VM workspace cleanup cron
goal: Automatically clean up old run workspaces on VM to prevent disk filling up.
context:
  - VM disk hit 98% full causing npm ci failures
  - Old run-workspaces and run-artifacts accumulate (~400MB per run)
  - Need automated cleanup decoupled from run lifecycle
acceptance_criteria:
  - Hourly cron job on VM deletes workspaces older than 6 hours
  - Cleans both run-workspaces and run-artifacts directories
  - Logs cleanup actions to syslog
  - Script handles errors gracefully (doesn't fail on permission issues)
non_goals:
  - Integration with runner code (cron is decoupled)
  - Local worktree cleanup (handled by git worktree prune)
  - Preserving failed run workspaces (6h is enough time to debug)
stop_conditions:
  - If 6 hours is too aggressive, increase to 24 hours
priority: 2
tags:
  - runner
  - reliability
  - infrastructure
  - vm
estimate_hours: 0.5
status: you_review
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on: []
era: v2
---
## Problem

VM disk fills up with old run workspaces:

```
Filesystem      Size  Used Avail Use%
/dev/root       9.6G  9.3G  276M  98%
```

Each run leaves ~400MB in `.system/run-workspaces/` and `.system/run-artifacts/`. After ~20 runs, disk is full and new runs fail.

## Solution

Create hourly cron script on VM:

```bash
#!/bin/bash
# /etc/cron.hourly/pcc-cleanup-workspaces

REPO_ROOT="/home/project/repo"
MAX_AGE_MINUTES=360  # 6 hours

logger -t pcc-cleanup "Starting workspace cleanup (max age: ${MAX_AGE_MINUTES}m)"

count=0
for dir in "$REPO_ROOT/.system/run-workspaces"/* "$REPO_ROOT/.system/run-artifacts"/*; do
  if [[ -d "$dir" ]] && [[ $(find "$dir" -maxdepth 0 -mmin +$MAX_AGE_MINUTES 2>/dev/null) ]]; then
    if rm -rf "$dir" 2>/dev/null; then
      logger -t pcc-cleanup "Deleted: $dir"
      ((count++))
    else
      logger -t pcc-cleanup "Failed to delete (permission?): $dir"
    fi
  fi
done

logger -t pcc-cleanup "Cleanup complete: $count directories removed"
```

## Implementation Steps

1. SSH to VM
2. Create script at `/etc/cron.hourly/pcc-cleanup-workspaces`
3. Make executable: `chmod +x /etc/cron.hourly/pcc-cleanup-workspaces`
4. Test manually: `sudo /etc/cron.hourly/pcc-cleanup-workspaces`
5. Verify in syslog: `grep pcc-cleanup /var/log/syslog`

## Files to Modify

1. VM: `/etc/cron.hourly/pcc-cleanup-workspaces` (new file)
