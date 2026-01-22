---
id: WO-2026-134
title: VM-Hosted PCC Data Migration + Backups
goal: Migrate PCC data to the VM and establish a reliable backup + restore plan.
context:
  - docs/pcc-vm-service-research-wo-2026-128.md
  - control-center.db at repo root (SQLite)
  - Work Orders live in work_orders/
acceptance_criteria:
  - Local control-center.db migrated to VM and validated
  - Work Orders and repo metadata copied to VM
  - Backup strategy implemented (SQLite backups + disk snapshots)
  - Restore procedure documented and tested once
  - Cutover checklist and rollback plan documented
non_goals:
  - Automated multi-region replication
  - Migrating historical run artifacts unless needed
stop_conditions:
  - If data integrity cannot be verified post-migration, pause and revert
priority: 2
tags:
  - infrastructure
  - data
  - backups
estimate_hours: 4
status: backlog
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-132
era: v2
---

## Notes
- Keep a local fallback snapshot for at least one week after cutover.
