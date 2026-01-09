---
id: WO-2026-039
title: VM provisioning + lifecycle (GCP/SSH/IP refresh)
goal: Implement GCP VM provisioning and lifecycle management with status persistence, SSH readiness, and error reporting.
context:
  - work_orders/WO-2026-027-vm-based-project-isolation.md (VM contract)
  - work_orders/WO-2026-038-vm-isolation-scaffolding-db-api-ui.md (schema + routes)
  - docs/work_orders.md (ready contract)
  - server/vm_manager.ts (new implementation)
  - server/index.ts (lifecycle endpoints)
  - server/db.ts (project_vms storage)
  - server/settings.ts (provider config)
acceptance_criteria:
  - vm_manager provisions a VM via gcloud with size/zone/image, writes instance id + IPs + status to project_vms.
  - start/stop/delete/resize update status, refresh external IP on start, and persist last_error on failure.
  - Provision/start waits for SSH readiness (user + key) before marking running.
  - Preflight checks for gcloud install + auth + required config; failure returns actionable errors and sets status=error.
  - Lifecycle endpoints return consistent responses and never leave status stale when commands fail.
non_goals:
  - Repo sync or remote execution (WO-2026-040).
  - Runner integration or artifact egress (WO-2026-041).
  - Per-run containers (WO-2026-028).
  - Cost metering (WO-2026-037).
stop_conditions:
  - If gcloud CLI or credentials are missing, stop and report (per WO-2026-027).
  - If SSH key management or firewall setup cannot be done safely, stop and report.
  - If required GCP project/zone/quotas are unknown, stop and ask.
priority: 2
tags:
  - runner
  - infra
  - vm
estimate_hours: 5
status: you_review
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-004
  - WO-2026-038
era: v1
---
## Notes
- 
