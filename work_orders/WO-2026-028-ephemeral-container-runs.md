---
id: WO-2026-028
title: Per-Run Containers Inside Project VM
goal: Execute each run inside a fresh container on the project's persistent VM, with cleanup and artifact capture per run.
context:
  - work_orders/WO-2026-027-vm-based-project-isolation.md (VM isolation foundation)
  - server/runner_agent.ts (execution path)
  - server/index.ts (API wiring)
  - docs/work_orders.md (contract)
acceptance_criteria:
  - When project mode is vm+container, each run creates a fresh container inside the project VM and removes it on completion or failure.
  - Run workspace is isolated per run; repo is copied from the VM-hosted repo and optional cache volumes are mounted.
  - Container execution captures stdout/stderr, exit codes, diffs/tests, and exports artifacts to host .system/runs/....
  - Base image selection follows project type with optional .control-container.yml overrides.
  - If the container runtime is unavailable or fails to start, runner falls back to VM-only execution and records the reason.
  - Container resource limits (cpu/memory/timeout) are applied from project defaults or overrides.
non_goals:
  - Kubernetes or multi-host orchestration.
  - Long-lived containers or shared workspaces between runs.
  - Reviewer or tester isolation beyond the builder/test container.
stop_conditions:
  - If the container runtime cannot be installed or configured safely on the VM, stop and report.
  - If mount permissions or artifact egress are unclear, stop and ask.
priority: 3
tags:
  - runner
  - infra
  - isolation
  - containers
estimate_hours: 6
status: ready
created_at: 2026-01-06
updated_at: 2026-01-08
depends_on:
  - WO-2025-004
  - WO-2026-027
era: v1
---
# Ephemeral Container Runs

## Overview

Each builder run executes in a fresh Docker container on the project's VM. The container provides a clean, isolated environment that's spun up for the run and torn down afterward. This ensures reproducible builds with no state leakage between runs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Project VM (e.g., project-control-center)                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Persistent Storage                                       │   │
│  │ /home/project/                                           │   │
│  │ ├── repo/              ← Main branch, always up to date │   │
│  │ ├── build-cache/       ← Optional: npm cache, etc.      │   │
│  │ └── run-artifacts/     ← Logs, diffs from past runs     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Container:      │  │ Container:      │                      │
│  │ run-abc123      │  │ run-def456      │  ← Parallel runs    │
│  │                 │  │                 │                      │
│  │ Fresh clone     │  │ Fresh clone     │                      │
│  │ npm install     │  │ npm install     │                      │
│  │ Builder agent   │  │ Builder agent   │                      │
│  │ Tests           │  │ Tests           │                      │
│  │                 │  │                 │                      │
│  │ [EPHEMERAL]     │  │ [EPHEMERAL]     │                      │
│  └─────────────────┘  └─────────────────┘                      │
│         │                    │                                  │
│         ▼                    ▼                                  │
│     Tear down            Tear down                             │
│     after run            after run                             │
└─────────────────────────────────────────────────────────────────┘
```

## Container Images

### Base Images by Project Type

| Project Type | Base Image | Included Tools |
|--------------|------------|----------------|
| Node/TypeScript | node:20-slim | npm, node, git |
| Python | python:3.11-slim | pip, python, git |
| Go | golang:1.21-alpine | go, git |
| Rust | rust:1.74-slim | cargo, rustc, git |
| Generic | ubuntu:22.04 | git, curl, build tools |

### Project-Specific Customization

Projects can provide a `.control-container.yml` for custom requirements:

```yaml
# .control-container.yml
base: node:20-slim
apt_packages:
  - ffmpeg
  - imagemagick
npm_global:
  - typescript
  - tsx
env:
  NODE_ENV: development
resource_limits:
  memory: 4g
  cpus: 2
```

## Run Flow

```
1. Run triggered
   └── PCC connects to project VM via SSH

2. Container created
   └── docker run --name run-{shortId} \
         --memory=4g --cpus=2 \
         -v /home/project/repo:/repo:ro \
         -v /home/project/build-cache:/cache \
         -w /workspace \
         {base-image}

3. Inside container
   └── Clone repo to /workspace (or copy from /repo)
   └── Install dependencies (npm install, pip install, etc.)
   └── Run builder agent
   └── Run tests
   └── Capture results

4. Results extracted
   └── Copy artifacts (diff, logs) to /home/project/run-artifacts/{runId}/
   └── If success: apply changes to /home/project/repo/

5. Container torn down
   └── docker rm -f run-{shortId}
   └── Container deleted, all state gone
```

## Implementation

### Container Management

```typescript
// server/container_runner.ts

interface ContainerConfig {
  runId: string;
  projectId: string;
  image: string;
  memoryLimit: string;  // e.g., '4g'
  cpuLimit: number;     // e.g., 2
  env: Record<string, string>;
  mounts: Array<{
    hostPath: string;
    containerPath: string;
    readOnly: boolean;
  }>;
}

interface ContainerRun {
  containerId: string;
  status: 'creating' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  logs: string;
}

export async function createContainer(config: ContainerConfig): Promise<string>;
export async function execInContainer(containerId: string, command: string): Promise<ExecResult>;
export async function getContainerLogs(containerId: string): Promise<string>;
export async function removeContainer(containerId: string): Promise<void>;
export async function waitForContainer(containerId: string): Promise<ContainerRun>;
```

### Runner Agent Integration

```typescript
// In runner_agent.ts, replace local execution with container execution

async function runBuilderInContainer(
  projectId: string,
  runId: string,
  workOrder: WorkOrder
): Promise<BuilderResult> {
  const vm = await getVMForProject(projectId);
  if (!vm) {
    // Fallback to local execution
    return runBuilderLocally(runId, workOrder);
  }

  const containerConfig = await buildContainerConfig(projectId, runId);
  const containerId = await createContainer(containerConfig);

  try {
    // Clone repo inside container
    await execInContainer(containerId, 'git clone /repo /workspace');

    // Install dependencies
    await execInContainer(containerId, 'npm install');

    // Run builder agent (codex/claude)
    const result = await execInContainer(containerId, buildAgentCommand(workOrder));

    // Run tests
    const testResult = await execInContainer(containerId, 'npm test');

    // Extract results
    const diff = await execInContainer(containerId, 'git diff');

    return {
      success: testResult.exitCode === 0,
      diff: diff.stdout,
      logs: await getContainerLogs(containerId),
    };
  } finally {
    // Always clean up
    await removeContainer(containerId);
  }
}
```

## Build Cache Management

To speed up runs, certain caches can persist:

```yaml
# Mounted as volumes, not copied into container
caches:
  - /home/project/cache/npm:/root/.npm          # npm cache
  - /home/project/cache/pip:/root/.cache/pip    # pip cache
  - /home/project/cache/node_modules:/workspace/node_modules  # optional
```

Cache can be cleared per-project if corruption suspected.

## Resource Limits

Default limits (configurable per project):

| Resource | Default | Max |
|----------|---------|-----|
| Memory | 4GB | 16GB |
| CPU | 2 cores | 8 cores |
| Disk | 20GB | 100GB |
| Timeout | 1 hour | 4 hours |

Runs exceeding limits are killed with clear error message.

## Logging and Debugging

- All container stdout/stderr captured
- Logs stored in `/home/project/run-artifacts/{runId}/container.log`
- Option to keep container running for debugging (manual override)
- Container events logged (create, start, stop, remove)

## Cleanup Policy

- Containers removed immediately after run completes
- Failed containers removed after 1 hour (allows debugging)
- Orphaned containers cleaned up daily
- Build caches pruned when exceeding size limit
