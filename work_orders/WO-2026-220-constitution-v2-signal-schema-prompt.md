---
id: WO-2026-220
title: Constitution v2 signal schema + prompt
goal: Update constitution generation analysis to emit v2 signal types with explicit scope and evidence so review UI can show actionable items.
context:
  - server/constitution_generation.ts (analysis schema + prompt)
  - app/components/ConstitutionGenerationWizard.tsx (insight review UI)
  - server/constitution.ts (constitution section mapping)
  - work_orders/WO-2026-047-constitution-v2-redesign.md
acceptance_criteria:
  - Analysis schema includes signal_type (correction|vocabulary|decision|approval|stop|meta) and scope (global|project).
  - Extraction prompt requires structured output per signal type (wrong/right for corrections, term/meaning for vocabulary, phrase/meaning for approval/stop).
  - Review UI groups insights by scope then signal type and preserves accept/reject/edit.
  - Stats/warnings remain accurate with the new schema.
non_goals:
  - Targeted retrieval or sampling changes.
  - Draft generation and save routing (separate WO).
stop_conditions:
  - If schema changes break existing wizard flow, add a compatibility layer before proceeding.
priority: 2
tags:
  - constitution
  - generation
  - schema
  - v2
estimate_hours: 6
status: done
created_at: 2026-01-27
updated_at: 2026-01-27
depends_on:
  - WO-2026-047
  - WO-2026-025
era: v2
---
## Notes
Add minimal tests around schema parsing and UI grouping.
