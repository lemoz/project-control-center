---
id: WO-2026-059
title: Fix container execution for builder/reviewer
goal: Investigate and fix why Docker container execution fails, falling back to local Codex.
context:
  - server/runner_agent.ts (container execution logic, runCodexInContainer)
  - "Error: Container runtime unavailable; falling back to local execution: docker unavailable: unknown error"
  - WO-2026-028 added ephemeral container support but it's not working
  - Local fallback causes EPERM issues due to Codex sandbox port restrictions
acceptance_criteria:
  - Diagnose why "docker unavailable: unknown error" occurs
  - Fix container execution so builder/reviewer run in Docker containers
  - Container can bind to ports (no EPERM)
  - Fallback to local execution only when Docker is genuinely unavailable (not installed)
non_goals:
  - Running builder/reviewer on VM via SSH (different approach)
  - Changing Codex sandbox restrictions
  - Supporting non-Docker container runtimes
stop_conditions:
  - If Docker cannot be made available on dev machine, document alternative approaches
priority: 2
tags:
  - runner
  - containers
  - infrastructure
  - docker
estimate_hours: 2
status: ready
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on: []
era: v1
---

## Problem

WO-2026-028 added support for running builder/reviewer in ephemeral Docker containers:

```
Running codex in container pcc-run-affddf3d-builder-1 (pcc-runner:latest)
Container runtime unavailable; falling back to local execution: docker unavailable: unknown error
```

The container execution fails with "unknown error" and falls back to local Codex execution. This causes:

1. Builder runs in Codex sandbox (port binding blocked)
2. Builder's `npm test` fails with EPERM
3. Reviewer sees false test failures

## Investigation Steps

1. **Check Docker availability**
   ```bash
   docker --version
   docker ps
   docker info
   ```

2. **Check Docker socket permissions**
   ```bash
   ls -la /var/run/docker.sock
   ```

3. **Inspect the container execution code**
   - `server/runner_agent.ts` - `runCodexInContainer` function
   - What error is being caught and logged as "unknown error"?

4. **Check if pcc-runner:latest image exists**
   ```bash
   docker images | grep pcc-runner
   ```

5. **Try manual container execution**
   ```bash
   docker run --rm pcc-runner:latest echo "test"
   ```

## Potential Fixes

1. **Docker not installed** → Install Docker Desktop
2. **Docker not running** → Start Docker daemon
3. **Image doesn't exist** → Build pcc-runner image
4. **Socket permissions** → Add user to docker group
5. **Code bug** → Fix error handling in runCodexInContainer

## Files to Investigate

- `server/runner_agent.ts` - Container execution logic
- `Dockerfile` or `docker/` - Container image definition (if exists)
- Any container-related scripts in `scripts/`
