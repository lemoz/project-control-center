---
id: WO-2026-027
title: VM-Based Project Isolation
goal: Give each project its own dedicated VM so projects are completely isolated from each other - different machines, different resources, no interference. PCC orchestrates remotely while execution happens on project-specific VMs.
context:
  - server/runner_agent.ts (current local execution)
  - server/repos.ts (project discovery and metadata)
  - server/db.ts (project tracking)
  - DECISIONS.md (mentions isolated execution targets)
acceptance_criteria:
  - Each project can be assigned a dedicated VM (GCP Compute Engine initially)
  - VM provisioning API - create VM for project with specified size/resources
  - VM lifecycle management - start, stop, delete, resize
  - SSH key management for secure remote execution
  - Project state (git repo) lives on the VM, cloned on first provision
  - PCC can execute commands on project VM remotely via SSH
  - VM status shown in project dashboard (running, stopped, not provisioned)
  - Cost tracking per project (VM hours, estimated monthly cost)
  - Support for right-sizing - small projects get small VMs, large projects get more resources
  - Graceful fallback to local execution if VM not provisioned
non_goals:
  - Multi-cloud support (GCP only for v1)
  - Auto-scaling or load balancing
  - Kubernetes or container orchestration platforms
  - Windows VMs (Linux only)
  - GPU instances (future work order)
stop_conditions:
  - If GCP provisioning is too slow (over 2 minutes), investigate preemptible pools or warm instances
  - If SSH connectivity is unreliable, consider alternative remote execution (Cloud Run, etc.)
  - If costs exceed reasonable limits, add hard caps and alerts
priority: 2
tags:
  - infrastructure
  - isolation
  - vm
  - gcp
  - autonomy
estimate_hours: 16
status: ready
created_at: 2026-01-06
updated_at: 2026-01-06
depends_on:
  - WO-2025-004
era: autonomous
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
