---
id: WO-2026-222
title: Scope-aware draft + save for global vs project constitution
goal: Generate and save separate constitutions for global and project scopes based on accepted v2 insights.
context:
  - server/constitution_generation.ts (draft step)
  - app/components/ConstitutionGenerationWizard.tsx (draft + save steps)
  - server/index.ts (constitution endpoints)
  - server/constitution.ts (merge rules)
  - work_orders/WO-2026-047-constitution-v2-redesign.md
acceptance_criteria:
  - Draft step produces separate drafts for global and project scopes from accepted insights.
  - Save step writes global insights to global constitution and project insights to the project constitution.
  - UI clearly labels which draft/scope is being edited and saved.
  - Conflicts are highlighted when a project item contradicts a global rule.
non_goals:
  - Changes to agent prompt injection or runtime selection logic.
  - Staleness detection or cross-project propagation.
stop_conditions:
  - If scope split complicates the wizard too much, start by splitting save paths while keeping a single combined draft view.
priority: 2
tags:
  - constitution
  - generation
  - scope
  - v2
estimate_hours: 6
status: ready
created_at: 2026-01-27
updated_at: 2026-01-27
depends_on:
  - WO-2026-047
  - WO-2026-220
  - WO-2026-025
era: v2
---
## Notes
Project constitution should remain an override on top of global, not a replacement.
