---
id: WO-2025-005
title: Settings UI for provider/model selection
goal: Add a real settings page to pick builder/reviewer provider and model (Codex active), stored locally.
context:
  - app/settings/page.tsx (placeholder)
  - server/providers/types.ts (settings shape)
acceptance_criteria:
  - Settings stored locally (SQLite or config file) and loaded by server.
  - UI lets you choose provider and model; Codex works end‑to‑end.
  - Per‑repo override hook exists (even if UI not fully built yet).
non_goals:
  - Implement Claude/Gemini providers.
priority: 4
tags:
  - settings
  - providers
  - ui
estimate_hours: 4
status: done
created_at: 2025-12-12
updated_at: 2025-12-15
stop_conditions: []
---
