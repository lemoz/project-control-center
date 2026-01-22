---
id: WO-2026-129
title: VM-Hosted PCC Baseline Deployment
goal: Run PCC UI/API/runner on a single VM using Docker Compose for always-on service.
context:
  - docs/pcc-vm-service-research-wo-2026-128.md
  - server/vm_manager.ts (current VM sizes)
  - control-center.db is stored at repo root by default
acceptance_criteria:
  - Docker Compose (or equivalent) config runs UI + API + runner on the VM
  - Services start on boot (systemd or docker compose service)
  - `control-center.db` persists on the VM disk
  - UI reachable locally on the VM and API responds on localhost
  - Basic runbook for start/stop/logs
non_goals:
  - Public HTTPS or auth (separate WO)
  - Data migration from local host (separate WO)
stop_conditions:
  - If VM resources are insufficient for UI/API/runner, document sizing gap and pause
priority: 2
tags:
  - infrastructure
  - vm
  - deployment
estimate_hours: 4
status: backlog
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---

## Notes
- Prefer Docker Compose for repeatable deployment.
- Keep the config minimal and scoped to PCC services only.
