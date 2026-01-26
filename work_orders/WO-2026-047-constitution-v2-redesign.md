---
id: WO-2026-047
title: Constitution v2 Redesign
goal: Redesign constitution generation to extract actionable, properly-scoped knowledge (global user preferences vs project-specific context).
context:
  - WO-2026-025 (current constitution generation - weak outputs)
  - WO-2026-026 (constitution injection)
  - ~/doittogether (DIT procedural knowledge extraction for reference)
  - server/constitution_generation.ts
acceptance_criteria:
  - Align on two-constitution model (global vs project)
  - Define signal types to extract (corrections, vocabulary, decisions, approvals, stops)
  - Define extraction approach (targeted search vs random sampling)
  - Break into implementable sub-WOs
non_goals:
  - Implementation (this is planning/alignment only)
stop_conditions:
  - If scope creep into implementation, stop and create separate WOs
priority: 2
tags:
  - constitution
  - planning
  - autonomous
  - v2
estimate_hours: 2
status: ready
created_at: 2026-01-10
updated_at: 2026-01-26
depends_on:
  - WO-2026-025
era: v2
---
## Problem

Current constitution generation (WO-2026-025) produces weak outputs:
- "Prefers minimal, scoped code changes" - vague, not actionable
- "Often asks for researched options" - describes behavior, not guidance
- No distinction between global (user-level) and project-level knowledge
- Samples conversations randomly instead of extracting specific signal types

## Key Insight: Two Constitutions

### Global Constitution = WHO THE USER IS
Stable preferences across ALL projects:
- Communication style ("be direct", "show code first")
- Decision-making patterns ("present options", "move fast")
- Quality bar ("don't over-engineer", "tests must pass")
- Values ("fix root cause", "simple over clever")
- Vocabulary ("'check in' = check status")
- Stop conditions ("ask before pushing")

### Project Constitution = WHAT THIS PROJECT IS
Context for agents on THIS repo:
- Tech stack (SQLite, Next.js, etc.)
- Conventions (file organization, API patterns)
- Architecture (worktree isolation, VM setup)
- Learned failures (what got rejected and why)
- Review criteria (which evolve as project evolves)

## Signal Types to Extract

1. **Correction pairs** (highest value): wrong → right mappings
2. **Vocabulary mappings**: user shorthand → meaning
3. **Decision points**: choices made and rationale
4. **Approval signals**: what phrases mean "go"
5. **Stop signals**: what should halt autonomous operation
6. **Meta-commentary**: user talking about how they want to work

## Reference: DIT Knowledge Types

From ~/doittogether - they extract **procedural knowledge** (how to do X):
- State A → Actions → State B → Success Signal

For constitution, we need:
- **Normative knowledge**: What SHOULD be done (rules, preferences)
- **Declarative knowledge**: What IS true (project facts)
- **Correction knowledge**: What was WRONG → RIGHT

## Open Questions

1. How to detect when constitution items become stale?
2. When project contradicts global, always prefer project?
3. Should corrections in one project propagate to others?
4. User editing: manual add or only approve/reject extractions?

## Notes
- User doesn't care about code style - don't extract those
- Normative rules are context-dependent (WO file rule changed after worktree isolation)
- This is feedstock for autonomous runs - must be actionable
