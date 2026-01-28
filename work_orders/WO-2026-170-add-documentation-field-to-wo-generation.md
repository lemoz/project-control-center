---
id: WO-2026-170
title: Add documentation field to WO generation
status: ready
priority: 3
tags:
  - wo-generation
  - prompts
  - documentation
estimate_hours: 0.5
depends_on:
  - WO-2026-169
era: v2
updated_at: 2026-01-28
goal: Add optional "documentation" field to work order generation prompt so LLM-generated WOs include relevant external docs for sandboxed builders.
context:
  - WO generation prompt at server/prompts/wo_generation.ts (buildWorkOrderGenerationPrompt)
  - WO generation logic at server/wo_generation.ts
  - Currently generates: title, goal, context, acceptance_criteria, non_goals, stop_conditions, tags, depends_on, estimate_hours, priority, suggestions
  - No field for embedding external documentation
acceptance_criteria:
  - buildWorkOrderGenerationPrompt() includes "documentation" in JSON output fields
  - Guidance added explaining documentation field purpose
  - Guidance mentions builders are sandboxed and need embedded docs
  - Documentation field is optional (empty string or omitted if not needed)
non_goals:
  - Auto-fetching documentation during WO generation
  - Validating documentation content
  - Changing WO storage schema (documentation goes in context or markdown body)
stop_conditions:
  - If WO schema requires migration, stop and report
---
