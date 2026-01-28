---
id: WO-2026-228
title: Targeted conversation retrieval for constitution signals
goal: Replace random sampling with targeted retrieval for v2 signal extraction, while keeping a small fallback sample for coverage.
context:
  - server/constitution_generation.ts (source loading + sampling)
  - work_orders/WO-2026-047-constitution-v2-redesign.md
acceptance_criteria:
  - Implement signal-specific candidate selection using keyword/regex cues and message metadata.
  - Expand each candidate into a small context window before sending to the extractor.
  - Maintain a backstop sample when targeted retrieval yields fewer than N candidates per source.
  - Report targeted vs fallback counts in analysis stats/warnings.
non_goals:
  - Changing the extraction schema or UI presentation.
  - Staleness or conflict handling.
stop_conditions:
  - If targeted retrieval produces zero candidates for a source, fall back to the latest N conversations and log a warning.
priority: 2
tags:
  - constitution
  - generation
  - retrieval
  - v2
estimate_hours: 5
status: you_review
created_at: 2026-01-27
updated_at: 2026-01-28
depends_on:
  - WO-2026-047
  - WO-2026-025
era: v2
---
## Notes
Start with deterministic keyword patterns; tune thresholds after seeing coverage stats.
