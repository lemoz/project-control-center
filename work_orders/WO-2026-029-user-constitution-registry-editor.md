---
id: WO-2026-029
title: User constitution registry + editor
goal: Create a versioned user constitution (preferences, decision rules, constraints) per project with a global fallback.
context:
  - DECISIONS.md (governance + local-first)
  - server/db.ts (schema)
  - app/projects/[id]/page.tsx (project UI)
  - app/settings/page.tsx (global settings UI)
acceptance_criteria:
  - Add storage for constitution versions with scope (global or project), statements list, source, created_at, active flag.
  - API endpoints return the active constitution (with global fallback), list versions, and create a new version.
  - UI provides a Constitution panel on project pages and in Settings; editing creates a new version and shows history.
  - Project-specific constitution overrides global; UI shows both.
  - Active constitution is exposed to the Work Order generator.
non_goals:
  - Automatic inference or extraction.
  - Enforcing constitution in agent prompts.
stop_conditions:
  - If statement schema becomes complex, start with a plain list of strings and versioning only.
priority: 2
tags:
  - planning
  - governance
  - ux
  - data
estimate_hours: 4
status: ready
created_at: 2026-01-07
updated_at: 2026-01-26
depends_on:
  - WO-2025-003
  - WO-2026-024
  - WO-2026-026
era: v1
---
## Notes
- 
