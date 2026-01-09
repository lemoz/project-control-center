---
id: WO-2025-010
title: "Runner smoke test: add README note"
goal: Validate Codex runner end-to-end by making a tiny, safe change.
context: []
acceptance_criteria:
  - README.md includes a short note that the Codex runner smoke test ran.
non_goals: []
stop_conditions:
  - If Codex CLI cannot run non-interactively, stop and report the failure and logs.
priority: 3
tags:
  - runner
  - smoke
estimate_hours: 0.5
status: done
depends_on:
  - WO-2025-004
era: v0
created_at: 2025-12-12
updated_at: 2025-12-13
---
## Notes
- 
