---
id: WO-2026-033
title: Raise max builder iterations to 10
goal: Default max builder iterations is 10 so reviewer loops can run longer without manual overrides.
context:
  - server/settings.ts (defaults + env overrides for maxBuilderIterations)
  - server/runner_agent.ts (iteration cap enforcement)
  - app/settings/RunnerSettingsForm.tsx (UI field for max builder iterations)
  - README.md (document default env value)
acceptance_criteria:
  - Default runner setting uses maxBuilderIterations = 10 when no override is provided.
  - Settings UI shows 10 as the default for Max builder iterations.
  - README documents CONTROL_CENTER_MAX_BUILDER_ITERATIONS default as 10.
  - Runs use the updated default cap unless overridden by env or per-repo settings.
non_goals:
  - Introduce a separate reviewer-specific iteration cap.
  - Change iteration behavior beyond adjusting the default cap.
  - Modify existing saved settings or per-repo overrides.
stop_conditions:
  - If changing the default would break validation or requires schema changes beyond a default update, stop and report.
  - If the default source of truth is unclear between server and UI, stop and ask.
priority: 2
tags:
  - runner
  - settings
estimate_hours: 0.5
status: done
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on: []
era: autonomous
---
## Notes
- 
