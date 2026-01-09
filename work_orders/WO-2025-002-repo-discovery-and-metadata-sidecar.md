---
id: WO-2025-002
title: Repo discovery + .control.yml sidecar
goal: Replace mock portfolio with real local git repo discovery, persisted in SQLite, with per‑repo `.control.yml` metadata.
context:
  - server/index.ts (currently seeds mocks)
  - server/db.ts
  - DECISIONS.md (Hybrid portfolio metadata)
acceptance_criteria:
  - "`GET /repos` scans configured roots for git repos and returns real results."
  - Discovery ignores common junk folders (node_modules, .venv, dist, archive, etc.) and supports a user‑configurable ignore list.
  - For each repo, server reads `.control.yml` if present to set type/stage/status/priority/tags; otherwise uses safe defaults.
  - Server upserts discovered repos into SQLite and uses SQLite as the source of truth for last_run/history fields.
  - UI portfolio shows real repos and their metadata; no more mock seeding.
  - Docs added explaining discovery roots, ignore rules, and `.control.yml` schema.
non_goals:
  - Kanban Work Order CRUD or parsing work_orders in target repos.
  - Agent run orchestration.
stop_conditions:
  - If scanning full home directory is too slow, stop and propose an indexing strategy or narrower roots.
priority: 1
tags:
  - portfolio
  - scanner
  - metadata
estimate_hours: 5
status: done
created_at: 2025-12-12
updated_at: 2025-12-13
depends_on:
  - WO-2025-001
era: v0
---
## Notes
- Default discovery roots: `$HOME` (configurable via `CONTROL_CENTER_SCAN_ROOTS`).
- `.control.yml` should be small and human‑editable; server should not overwrite unknown keys.
