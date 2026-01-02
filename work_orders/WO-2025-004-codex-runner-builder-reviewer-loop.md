---
id: WO-2025-004
title: "Codex runner + builder→reviewer loop"
goal: "Implement real Codex builder and fresh reviewer runs with handoff summaries, artifacts, and gating before human review."
context:
  - "server/providers/* (stubs)"
  - "DECISIONS.md (Two-agent gate, summary-first UX)"
acceptance_criteria:
  - "Runner can execute Codex CLI in a repo with a Work Order context."
  - "Builder produces summary, files changed, diff, tests status, risks, stored under `.system/runs/<id>/`."
  - "Reviewer runs in a fresh session against Work Order + diff only and returns approve/changes_requested."
  - "If changes requested, builder loops until reviewer approves."
  - "UI shows run progress/logs and surfaces only approved summaries to you."
non_goals:
  - "Claude Code / Gemini support."
  - "Full diff UI."
stop_conditions:
  - "If Codex CLI automation is flaky, stop and propose a more reliable invocation pattern."
priority: 3
tags: ["runner", "codex", "review-gate"]
estimate_hours: 8
status: done
created_at: "2025-12-12"
updated_at: "2025-12-12"
---
