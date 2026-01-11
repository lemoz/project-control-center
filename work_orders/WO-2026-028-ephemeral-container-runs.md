---
id: WO-2026-028
title: Per-Run Containers Inside Project VM
goal: Execute builder and reviewer agents inside fresh containers on the project's VM, with full isolation and artifact capture.
context:
  - server/runner_agent.ts:1943 (runRun orchestration, codexExec calls)
  - server/runner_agent.ts:938 (codexExec - currently spawns local codex process)
  - server/remote_exec.ts (remoteExec, remoteUpload, remoteDownload)
  - server/vm_manager.ts:289 (buildPrereqInstallScript - docker.io already installed)
  - work_orders/WO-2026-027-vm-based-project-isolation.md (VM foundation - done)
  - work_orders/WO-2026-041-runner-integration-artifact-egress-remote-test-setup.md (tests on VM - done)
acceptance_criteria:
  - When project isolation_mode is "vm", builder and reviewer run inside containers on the VM (not locally).
  - Each run creates a fresh container with Codex CLI pre-installed and OPENAI_API_KEY injected.
  - Container has access to run workspace at /workspace (copied from VM's .system/run-workspaces/{runId}).
  - Builder/reviewer output (result.json, logs) are extracted back to host .system/runs/{runId}/.
  - Container is removed after run completes (success or failure).
  - Fallback to local execution if container creation fails, with recorded reason.
  - Baseline tests and post-builder tests continue running on VM (not in container).
non_goals:
  - Kubernetes or multi-host orchestration.
  - Running tests inside containers (current VM execution is sufficient).
  - Custom container images per project (use standard image with Codex).
  - Parallel runs in same VM (sequential for now).
stop_conditions:
  - If Codex CLI cannot run inside container, stop and report.
  - If OPENAI_API_KEY injection is insecure, stop and ask.
priority: 1
tags:
  - runner
  - infra
  - isolation
  - containers
  - codex
estimate_hours: 4
status: ready
created_at: 2026-01-06
updated_at: 2026-01-11
depends_on:
  - WO-2026-027
  - WO-2026-041
era: v1
---
# Ephemeral Container Runs

## Current State (as of 2026-01-11)

The VM infrastructure is working:
- ✅ VM provisioning via GCP (`vm_manager.ts`)
- ✅ SSH access via `CONTROL_CENTER_GCP_SSH_USER` and `CONTROL_CENTER_GCP_SSH_KEY_PATH`
- ✅ Remote execution via `remoteExec()` in `remote_exec.ts`
- ✅ Baseline tests run on VM
- ✅ Post-builder tests run on VM
- ✅ Artifacts sync back to host via `remoteDownload()`
- ✅ Docker installed on VM (in prereq script)
- ✅ Playwright system deps installed on VM

**What's NOT on VM yet:**
- ❌ Builder (Codex) - runs locally via `codexExec()` spawning `codex` CLI
- ❌ Reviewer (Codex) - runs locally via `codexExec()`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Host (macOS)                                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ PCC Server (server/index.ts)                            │   │
│  │ ├── runRun() orchestrates                               │   │
│  │ ├── Syncs worktree to VM                                │   │
│  │ ├── Triggers container execution via SSH                │   │
│  │ └── Downloads artifacts back                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         │ SSH + rsync                                           │
│         ▼                                                       │
┌─────────────────────────────────────────────────────────────────┐
│  Project VM (GCP)                                               │
│  IP: from project.vm.external_ip                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ /home/project/                                          │   │
│  │ ├── repo/                    ← Main branch sync         │   │
│  │ └── .system/                                            │   │
│  │     └── run-workspaces/                                 │   │
│  │         └── {runId}/         ← Per-run worktree         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Container: pcc-run-{shortId}                            │   │
│  │ Image: pcc-runner:latest (Node 20 + Codex CLI)          │   │
│  │                                                         │   │
│  │ Mounts:                                                 │   │
│  │ - /home/project/.system/run-workspaces/{runId}          │   │
│  │   → /workspace (rw)                                     │   │
│  │                                                         │   │
│  │ Environment:                                            │   │
│  │ - OPENAI_API_KEY (injected securely)                    │   │
│  │                                                         │   │
│  │ Runs:                                                   │   │
│  │ 1. cd /workspace                                        │   │
│  │ 2. codex --model gpt-5.2-codex ... (builder)            │   │
│  │ 3. codex --model gpt-5.2-codex ... (reviewer)           │   │
│  │                                                         │   │
│  │ [EPHEMERAL - removed after run]                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Tests run directly on VM (not in container):                   │
│  - npm test (Playwright + Chrome)                               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Container Image

Create a Dockerfile for the runner container:

```dockerfile
# Dockerfile.pcc-runner
FROM node:20-slim

# Install system deps
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Codex CLI
RUN npm install -g @anthropic-ai/codex-cli

# Working directory
WORKDIR /workspace

# Default command (overridden per run)
CMD ["bash"]
```

Build and push to VM during provisioning:
```bash
# In buildPrereqInstallScript() additions
docker build -t pcc-runner:latest -f /home/project/repo/.docker/Dockerfile.pcc-runner /home/project/repo/.docker/
```

### Phase 2: Container Execution Functions

Add to `server/remote_exec.ts`:

```typescript
interface ContainerExecOptions {
  projectId: string;
  runId: string;
  command: string;
  env?: Record<string, string>;
  workspacePath: string;
  timeout?: number;
}

export async function remoteContainerExec(opts: ContainerExecOptions): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const shortId = opts.runId.slice(0, 8);
  const containerName = `pcc-run-${shortId}`;

  // Build docker run command
  const envFlags = Object.entries(opts.env || {})
    .map(([k, v]) => `-e ${k}=${shellEscape(v)}`)
    .join(' ');

  const dockerCmd = [
    'docker run --rm',
    `--name ${containerName}`,
    '--network host',  // For API access
    `-v ${opts.workspacePath}:/workspace`,
    envFlags,
    '-w /workspace',
    'pcc-runner:latest',
    `bash -c ${shellEscape(opts.command)}`
  ].join(' ');

  return remoteExec(opts.projectId, dockerCmd, {
    timeout: opts.timeout || 600000,  // 10 min default
  });
}
```

### Phase 3: Modify codexExec for Remote Execution

In `server/runner_agent.ts`, modify `codexExec()`:

```typescript
async function codexExec(params: CodexExecParams): Promise<CodexExecResult> {
  const project = findProjectById(params.projectId);
  const vm = project ? getProjectVm(project.id) : null;

  // If VM mode and VM is running, execute in container
  if (project?.isolation_mode === 'vm' && vm?.status === 'running') {
    return codexExecRemote(params, vm);
  }

  // Fallback to local execution
  return codexExecLocal(params);
}

async function codexExecRemote(
  params: CodexExecParams,
  vm: ProjectVmRow
): Promise<CodexExecResult> {
  // Build codex command
  const codexCmd = buildCodexCommand(params);

  // Execute in container with OPENAI_API_KEY
  const result = await remoteContainerExec({
    projectId: params.projectId,
    runId: params.runId,
    command: codexCmd,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    },
    workspacePath: params.workspacePath,
    timeout: params.timeout,
  });

  // Parse result, handle escalation, etc.
  return parseCodexResult(result, params);
}
```

### Phase 4: Secret Injection

Options for OPENAI_API_KEY:
1. **Pass via docker -e** (current plan) - Key visible in process list briefly
2. **Docker secrets** - More secure but requires swarm mode
3. **File mount** - Write key to temp file, mount, delete after

Recommended: Option 1 for simplicity, with process isolation via container.

### Phase 5: Update VM Prereqs

Modify `buildPrereqInstallScript()` in `vm_manager.ts`:

```typescript
// After existing prereqs, add:
"  # Build PCC runner image if Dockerfile exists",
"  if [ -f /home/project/repo/.docker/Dockerfile.pcc-runner ]; then",
"    docker build -t pcc-runner:latest -f /home/project/repo/.docker/Dockerfile.pcc-runner /home/project/repo/.docker/",
"  fi",
```

## Run Flow (Updated)

```
1. runRun() starts
   ├── Create worktree locally
   └── Sync to VM: .system/run-workspaces/{runId}/

2. Baseline health check
   └── remoteExec("npm test") on VM (not in container)

3. Builder iteration
   ├── remoteContainerExec() spawns container
   ├── Container runs: codex --model gpt-5.2-codex ...
   ├── Builder writes to /workspace/builder/iter-N/result.json
   └── Container removed

4. Post-builder tests
   └── remoteExec("npm test") on VM (not in container)

5. Reviewer iteration
   ├── remoteContainerExec() spawns new container
   ├── Container runs: codex --model gpt-5.2-codex ...
   ├── Reviewer writes to /workspace/reviewer/iter-N/result.json
   └── Container removed

6. Artifact sync
   └── remoteDownload() copies results to host .system/runs/{runId}/
```

## Files to Modify

1. **server/remote_exec.ts**
   - Add `remoteContainerExec()` function

2. **server/runner_agent.ts**
   - Modify `codexExec()` to check isolation_mode
   - Add `codexExecRemote()` for container execution
   - Update `buildCodexCommand()` if needed

3. **server/vm_manager.ts**
   - Add Docker image build to prereqs

4. **New: .docker/Dockerfile.pcc-runner**
   - Runner container image with Codex CLI

## Testing

1. Verify container can run codex:
   ```bash
   ssh user@vm "docker run --rm -e OPENAI_API_KEY=... pcc-runner:latest codex --version"
   ```

2. Test full run with isolation_mode=vm

3. Verify artifacts are extracted correctly

4. Test fallback when Docker fails

## Risks

- **API key exposure**: Mitigated by container isolation, key only in container env
- **Container build time**: Build image during VM provision, not per-run
- **Network access**: Container needs outbound HTTPS for OpenAI API
- **Disk space**: Containers are ephemeral, cleaned up after run
