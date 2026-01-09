---
id: WO-2025-008
title: "Starred projects in portfolio"
goal: "Let me star projects so they stay pinned at the top of the Portfolio list."
context:
  - "server/db.ts"
  - "server/index.ts"
  - "server/sidecar.ts"
  - "app/page.tsx"
  - "docs/repo_discovery.md"
acceptance_criteria:
  - "Projects have a `starred` flag in SQLite and optional `.control.yml`."
  - "`GET /repos` returns `starred` and sorts starred repos first."
  - "Portfolio UI shows a star toggle and persists the change locally."
non_goals:
  - "Writing star state back to `.control.yml` from the UI."
stop_conditions:
  - "If schema migration requires more than add-column, stop and propose a plan."
priority: 1
tags: ["portfolio", "ux"]
estimate_hours: 1
status: done
depends_on:
  - WO-2025-002
era: v1
created_at: "2025-12-12"
updated_at: "2025-12-12"
---

## Summary
Starred projects act like pinned favorites across your portfolio. They can be set in `.control.yml` or toggled in the UI.
