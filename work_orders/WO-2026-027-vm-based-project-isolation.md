---
id: WO-2026-027
title: Persistent Project VM Isolation
goal: Provide a persistent per-project VM that hosts the repo and run workspace, routing runs through the VM with lifecycle controls and artifact egress.
context:
  - docs/work_orders.md (contract)
  - DECISIONS.md (future isolated execution targets)
  - server/runner_agent.ts (execution path)
  - server/index.ts (API routes)
  - server/db.ts (schema/migrations)
  - app/projects/[id]/page.tsx (project overview UI)
acceptance_criteria:
  - Project config stores a VM isolation mode (vm or vm+container) plus persistent VM metadata (provider/instance id, status, size, repo path).
  - Provisioning creates a per-project VM and initializes the repo inside the VM (clone or sync) with base runtime prerequisites.
  - Runner routes runs into the VM when VM mode is enabled; if the VM is stopped, it is started or the run fails with a clear error.
  - VM lifecycle actions are available (provision, start, stop, delete, resize) with status reporting and error handling.
  - Run artifacts (logs, diffs, test outputs) are copied back to host .system/runs/... and linked to the run record.
  - Project UI surfaces VM status, last activity, and lifecycle controls.
non_goals:
  - Per-run containers (WO-2026-028).
  - Multi-cloud orchestration or autoscaling.
  - Deep network isolation beyond the VM boundary.
  - Automatic secrets distribution beyond existing env handling.
stop_conditions:
  - If VM provisioning tooling or credentials are unavailable, stop and report.
  - If repo sync or artifact egress between host and VM is unclear, stop and ask.
priority: 3
tags:
  - runner
  - infra
  - isolation
  - vm
estimate_hours: 8
status: done
created_at: 2026-01-06
updated_at: 2026-01-09
depends_on:
  - WO-2025-004
era: v1
---
# VM-Based Project Isolation

## Overview

Each project gets its own dedicated VM. This provides complete isolation between projects - different machines, different resources, no possibility of interference. PCC orchestrates remotely while actual execution happens on project-specific VMs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Laptop (PCC Control Plane)                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Project Control Center                                   │   │
│  │ - Orchestrates runs                                      │   │
│  │ - Manages VM lifecycle                                   │   │
│  │ - Stores metadata, work orders, run history             │   │
│  │ - SSH connections to project VMs                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    SSH / Remote Execution
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ GCP VM:       │    │ GCP VM:       │    │ GCP VM:       │
│ project-      │    │ dandelion-    │    │ other-        │
│ control-ctr   │    │ space         │    │ project       │
│               │    │               │    │               │
│ e2-medium     │    │ e2-small      │    │ e2-standard-4 │
│ 4GB RAM       │    │ 2GB RAM       │    │ 16GB RAM      │
│               │    │               │    │               │
│ /home/project │    │ /home/project │    │ /home/project │
│ └── repo/     │    │ └── repo/     │    │ └── repo/     │
└───────────────┘    └───────────────┘    └───────────────┘
    Isolated             Isolated             Isolated
```

## VM Sizing Presets

| Size | Machine Type | RAM | vCPUs | Use Case |
|------|--------------|-----|-------|----------|
| small | e2-small | 2GB | 1 | Simple scripts, small CLIs |
| medium | e2-medium | 4GB | 2 | Typical web apps, Node projects |
| large | e2-standard-4 | 16GB | 4 | Large builds, ML preprocessing |
| xlarge | e2-standard-8 | 32GB | 8 | Heavy computation |

## Implementation

### VM Provisioning

```typescript
// server/vm_manager.ts

interface VMConfig {
  projectId: string;
  size: 'small' | 'medium' | 'large' | 'xlarge';
  zone: string;  // e.g., 'us-central1-a'
  image: string; // e.g., 'ubuntu-2204-lts'
}

interface VMInstance {
  id: string;
  projectId: string;
  gcpInstanceName: string;
  externalIp: string;
  internalIp: string;
  status: 'provisioning' | 'running' | 'stopped' | 'deleted';
  size: string;
  createdAt: string;
  hourlyRate: number;
}

export async function provisionVM(config: VMConfig): Promise<VMInstance>;
export async function startVM(projectId: string): Promise<void>;
export async function stopVM(projectId: string): Promise<void>;
export async function deleteVM(projectId: string): Promise<void>;
export async function getVMStatus(projectId: string): Promise<VMInstance | null>;
export async function resizeVM(projectId: string, newSize: string): Promise<void>;
```

### SSH Execution

```typescript
// server/remote_exec.ts

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function remoteExec(
  projectId: string,
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<ExecResult>;

export async function remoteUpload(
  projectId: string,
  localPath: string,
  remotePath: string
): Promise<void>;

export async function remoteDownload(
  projectId: string,
  remotePath: string,
  localPath: string
): Promise<void>;
```

### Database Schema

```sql
CREATE TABLE project_vms (
  project_id TEXT PRIMARY KEY,
  gcp_instance_name TEXT,
  gcp_zone TEXT,
  external_ip TEXT,
  internal_ip TEXT,
  status TEXT NOT NULL DEFAULT 'not_provisioned',
  size TEXT,
  created_at TEXT,
  last_started_at TEXT,
  total_hours_used REAL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### API Endpoints

```
POST /repos/:id/vm/provision  - Create VM for project
POST /repos/:id/vm/start      - Start stopped VM
POST /repos/:id/vm/stop       - Stop running VM
DELETE /repos/:id/vm          - Delete VM
GET /repos/:id/vm             - Get VM status and info
PUT /repos/:id/vm/resize      - Change VM size
```

## Initial Setup Flow

1. User enables VM isolation for a project (or globally)
2. PCC provisions VM via GCP API
3. PCC SSHs in, clones project repo
4. PCC installs base dependencies (Node, Python, Docker, etc.)
5. VM is ready for builder runs

## Cost Management

- Track hours per project VM
- Show estimated monthly cost in UI
- Auto-stop VMs after N hours of inactivity (configurable)
- Warn before provisioning large VMs
- Dashboard shows total infrastructure costs

## Security

- SSH keys generated per project, stored securely
- VMs in private VPC, only SSH exposed
- No secrets stored on VMs (injected at runtime)
- VMs can be locked down to only accept connections from PCC IP

## Fallback

If VM not provisioned, runs can still execute locally (current behavior). This allows gradual migration - provision VMs for projects that need isolation, keep others local.
