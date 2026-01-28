---
id: WO-2026-031
title: Constitution synthesis + review workflow
goal: Generate constitution update suggestions from signals and require human approval.
context:
  - WO-2026-029 (constitution registry)
  - WO-2026-030 (signals capture)
  - server/runner_agent.ts (Codex CLI)
acceptance_criteria:
  - Manual trigger generates constitution suggestions using local Codex with recent signals and the current constitution.
  - Suggestions are stored with status (pending/accepted/rejected), text, and evidence references.
  - UI supports review, accept, and reject; accepting creates a new constitution version.
  - Generation is rate-limited and does not auto-apply.
  - Audit trail records who/when accepted or rejected.
non_goals:
  - Auto-apply or background generation.
  - Replacing manual editing.
stop_conditions:
  - If model quality is poor, stop and keep manual editing only.
priority: 4
tags:
  - planning
  - learning
  - ai
  - governance
estimate_hours: 6
status: you_review
created_at: 2026-01-07
updated_at: 2026-01-28
depends_on:
  - WO-2026-029
  - WO-2026-030
  - WO-2025-004
era: v1
---
## Notes
- 
