---
id: WO-2026-038
title: VM isolation scaffolding (DB + API + UI)
goal: Add VM isolation scaffolding (DB schema, API routes, UI panel) so VM mode and metadata are stored and visible without provisioning logic.
context:
  - work_orders/WO-2026-027-vm-based-project-isolation.md (requirements)
  - work_orders/WO-2026-028-ephemeral-container-runs.md (vm+container mode)
  - docs/work_orders.md (ready contract)
  - server/db.ts (schema + migrations)
  - server/index.ts (repo routes)
  - app/projects/[id]/page.tsx (project UI)
  - app/projects/[id]/VMPanel.tsx (new panel scaffolding)
acceptance_criteria:
  - DB schema includes project_vms table and project config fields for isolation_mode and vm_size, with safe migrations for existing DBs.
  - API routes expose VM status + metadata and allow updating isolation mode/size; lifecycle endpoints exist but return a clear not-implemented error until WO-2026-039.
  - Project UI shows VM status, last activity/error, mode selector, size selector, and lifecycle buttons disabled with reason when not provisioned.
  - Server and UI compile without missing imports or placeholder files.
non_goals:
  - Provisioning/start/stop/resize/delete implementation (WO-2026-039).
  - SSH/remote exec or repo sync (WO-2026-040).
  - Runner routing or artifact egress (WO-2026-041).
stop_conditions:
  - If migrations would delete or rewrite existing project data, stop and report.
  - If project settings schema conflicts with existing settings model, stop and ask.
  - If UI changes require a broader redesign of the project page, stop and ask.
priority: 3
tags:
  - runner
  - infra
  - vm
  - ui
estimate_hours: 2
status: done
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-004
era: v1
---
## Notes
- 
