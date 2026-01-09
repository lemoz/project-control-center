---
id: WO-2026-035
title: Environment event ledger (SQLite)
goal: Add an append-only environment event ledger in SQLite to record cost and operational events and compute burn/runway.
context:
  - server/db.ts
  - server/runner_agent.ts
  - app/projects/[id]/page.tsx
  - work_orders/WO-2026-030-outcome-decision-signal-capture.md
acceptance_criteria:
  - "Create `environment_events` table with fields: `id`, `project_id`, `run_id`, `type`, `cost_usd` (nullable), `payload_json`, `created_at`."
  - Provide API to append and list events by project/time/type, plus a summary endpoint (burn_rate, runway, last_cost).
  - Base event types include `run_started`, `run_completed`, `run_failed`, `secret_accessed`, `vm_runtime_cost`, `token_cost`, `api_cost`, `manual_charge`, `env_change_applied`.
  - Ledger is append-only; no UI for editing events; UI may show a read-only summary or recent list.
  - Derived metrics use a rolling window (default 30 days) with configurable lookback.
non_goals:
  - Replace or merge with `signals` (WO-2026-030).
  - Full analytics dashboard or forecasting.
  - Charge for non-monetary actions.
stop_conditions:
  - If overlap with signals is confusing, keep this ledger strictly to operational/cost events and document boundaries.
  - If cost summary formulas are unclear, stop and ask.
priority: 3
tags:
  - ledger
  - data
  - infra
estimate_hours: 4
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-004
  - WO-2026-034
era: v2
---
## Notes
- 
