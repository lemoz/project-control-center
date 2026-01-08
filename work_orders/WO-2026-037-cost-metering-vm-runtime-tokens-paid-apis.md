---
id: WO-2026-037
title: Cost metering (VM runtime + tokens + paid APIs)
goal: Record real costs (VM runtime, token usage, paid APIs, manual charges) into the ledger using USD rates from the environment file.
context:
  - server/runner_agent.ts
  - server/db.ts
  - work_orders/WO-2026-034-environment-primitive-yaml-schema.md
  - work_orders/WO-2026-035-environment-event-ledger-sqlite.md
  - work_orders/WO-2026-027-vm-based-project-isolation.md
acceptance_criteria:
  - Compute VM runtime cost from VM size and runtime using rates in `.control.env.yml`; emit `vm_runtime_cost` events with units and cost.
  - Capture token usage when available; compute cost from per-model input/output rates; if rates missing, record usage with zero cost and a warning.
  - Support paid API cost events via manual entry (WO-approved) and store rate used and unit in event payload.
  - "Expose cost summary per project: total spend, burn_rate, runway, last_run_cost."
  - Only monetary sources produce cost events; all amounts in USD.
non_goals:
  - Charging every action or speculative costs.
  - Automatic budget top-ups or invoicing.
  - Auto-pricing discovery without supplied rates.
stop_conditions:
  - If token usage data is unavailable, ship VM and manual API costs first and flag token metering as pending.
  - If rate sources are unclear, stop and request pricing table.
priority: 3
tags:
  - cost
  - billing
  - infra
estimate_hours: 6
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2026-034
  - WO-2026-035
  - WO-2026-027
  - WO-2025-004
era: autonomous
---
## Notes
- 
