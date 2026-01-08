---
id: WO-2026-034
title: Environment primitive + YAML schema
goal: Define a per-project environment primitive stored in `.control.env.yml` that captures budget, policy, isolation, pricing, and secret refs plus agent-contributed worldview, with a read-only UI view.
context:
  - DECISIONS.md
  - docs/work_orders.md
  - server/repos.ts
  - server/db.ts
  - app/projects/[id]/page.tsx
acceptance_criteria:
  - Define versioned `.control.env.yml` at repo root; schema validated server-side; missing file yields a not-configured state without errors.
  - File stores non-secret config only; secret values never stored, only `secrets.refs` entries.
  - "Top-level sections: `meta` (schema version), `budget` (USD totals/policies), `pricing` (vm hourly + model/api rates), `policies` (run limits + review thresholds), `isolation` (mode + VM defaults), `secrets.refs`, `agent` (notes/assumptions/requests)."
  - Server exposes the environment via API; UI shows a read-only Environment panel on the project page.
  - Edits occur only via Work Orders; no in-app editor.
non_goals:
  - Secret storage or injection (WO-2026-036).
  - Event ledger or burn/runway calculations (WO-2026-035/037).
  - Model pricing research (rates supplied later).
stop_conditions:
  - "If schema scope is too broad, ship a minimal subset: `budget`, `pricing`, `isolation`, `secrets.refs`, `agent`, `meta`."
  - If validation or parsing breaks existing repos, stop and propose a migration/compat plan.
priority: 2
tags:
  - environment
  - infra
  - agent-os
estimate_hours: 4
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-002
era: autonomous
---
## Notes
- 
