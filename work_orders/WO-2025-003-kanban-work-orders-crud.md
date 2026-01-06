---
id: WO-2025-003
title: "Kanban Work Orders CRUD"
goal: "List/create/update Work Order cards per repo, enforce Ready contract, and render a functional Kanban in the UI."
context:
  - "docs/work_orders.md (contract)"
  - "app/projects/[id]/page.tsx (placeholder)"
acceptance_criteria:
  - "Server can list Work Orders for a repo by reading `work_orders/*.md` and parsing YAML frontmatter."
  - "Server exposes endpoints to create a new Work Order and to update its status/fields."
  - "Ready contract enforced server-side (required fields before status=ready/run)."
  - "UI project page renders columns and cards based on status; basic drag/drop or status change UI is ok."
  - "Global dashboard can show top 1–3 next Ready/Building cards per repo."
non_goals:
  - "Agent run execution."
  - "Advanced filtering/search."
stop_conditions:
  - "If parsing frontmatter across repos is messy, stop and propose a simplified storage strategy."
priority: 2
tags: ["kanban", "work_orders", "ui"]
estimate_hours: 6
status: done
created_at: "2025-12-12"
updated_at: "2025-12-12"
depends_on:
  - WO-2025-001
  - WO-2025-002
era: foundation
---
