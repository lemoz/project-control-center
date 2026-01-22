# WO-2026-129 Foreign Key Investigation

## Summary
- Both failing runs show `FOREIGN KEY constraint failed` immediately after the run-branch merge and before any merge-lock logging.
- The only DB write in that window is merge-lock acquisition.

## Evidence
- `./.system/runs/777fbf7d-8f01-4cd3-823e-6027c2d5925c/run.log` line 47.
- `./.system/runs/a8f2283c-e3f3-49ec-9c1c-f1392b12c417/run.log` line 41.
- `server/runner_agent.ts` performs `acquireMergeLock(...)` right after the merge into the run branch.

## Failing FK
- `merge_locks.project_id` -> `projects.id` (`server/db.ts`).

## Code Path
- `runRun` -> merge phase -> `mergeBaseIntoBranch` -> `writeMergeArtifacts` -> merge-lock loop -> `acquireMergeLock` (`server/runner_agent.ts`).
- No logs appear between `git merge` and the error, which aligns with the merge-lock insert failing before any log statement in the loop.

## Root Cause
- Project IDs can change during a rescan (`syncAndListRepoSummaries` -> `mergeProjectsByPath`).
- The runner caches `project.id` at run start. If a rescan merges duplicate projects, the old project row is deleted and all FK references (including `runs.project_id`) are updated to the new canonical ID.
- The running process continues to use the stale `project.id` for merge-lock insertion, which then fails the FK constraint.

## Reproduction (Best Effort)
1. Start a run on a project.
2. While the run is still building, trigger a repo rescan (`POST /repos/scan` or chat action `repos_rescan`).
3. Ensure the scan causes `mergeProjectsByPath` to switch the canonical project ID (e.g., introduce/remove a `.control.yml` id or have duplicate entries by path).
4. Let the run reach "Preparing merge to main"; it fails when acquiring the merge lock.

## Fix Implemented
- Refresh the project ID from the run row before acquiring and releasing the merge lock, and log once if it changed.
- This avoids using a stale project ID after a rescan has merged project rows.

## Follow-up (Optional)
- Skip `mergeProjectsByPath` while active runs exist to avoid mid-run project-id churn.
- Consider refreshing project IDs for other DB writes (cost records, VM activity) to avoid silent FK drops.
