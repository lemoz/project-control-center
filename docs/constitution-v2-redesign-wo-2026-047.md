# WO-2026-047 Constitution v2 Redesign

**Status: Planning Complete**

## Goal
Redesign constitution generation so it produces actionable, scoped knowledge for autonomous agents.

## Decisions

### Two-Constitution Model (Global vs Project)
- Global constitution captures user-level preferences that should apply across projects.
- Project constitution captures repo-specific facts, conventions, and learned failures.
- Precedence: project overrides global when conflicts exist; merge order is global then project.
- Scope assignment defaults:
  - Global: communication style, decision heuristics, approvals/stops, vocabulary used across projects.
  - Project: stack/tooling, file structure, repo rules, project-specific corrections.
  - If uncertain, default to project and let the reviewer re-scope.

### Signal Types to Extract (v2)
| Signal type | Definition | Output shape | Default scope |
| --- | --- | --- | --- |
| correction | Explicit wrong -> right mapping from user feedback | `wrong`, `right`, `rationale` | project unless clearly global |
| vocabulary | Shorthand -> meaning mapping | `term`, `meaning` | global unless repo-specific |
| decision | Choice + rationale + constraints | `decision`, `rationale` | global unless repo-specific |
| approval | Phrases that mean "go" or "accepted" | `phrase`, `meaning` | global |
| stop | Phrases that mean "halt and ask" | `phrase`, `meaning` | global |
| meta | Commentary on how to work together | `rule` | global |

### Constitution Section Mapping
- correction -> Anti-Patterns or Decision Heuristics (when it is a rule).
- vocabulary -> Communication (or Domain Knowledge if repo-specific).
- decision -> Decision Heuristics.
- approval/stop -> Communication (explicit approval/stop signals).
- meta -> Communication or Decision Heuristics.

### Extraction Approach (Targeted > Random)
- Primary mode: targeted retrieval by signal type.
  - Use keyword/regex cues: "do not", "instead", "prefer", "call it", "stop", "go ahead", "lgtm", "looks good", "ship", "ask before", "in this repo".
  - Extract small windows around matched user turns (2-3 messages before/after) to preserve context.
  - Run an LLM extraction pass per signal type with a strict schema.
- Backstop: small random sample only if targeted retrieval yields fewer than N insights or a source has zero matches.
- Record coverage stats (targeted vs random) so we can tune thresholds.

## Deliverables (Sub-WOs Created)
1. WO-2026-220 - Constitution v2 signal schema + prompt
2. WO-2026-221 - Targeted conversation retrieval for constitution signals
3. WO-2026-222 - Scope-aware draft + save for global vs project

## Open Questions (tracked for follow-up)
- Staleness detection: use last_seen_at + evidence_count decay?
- Conflict handling: auto-dedup or always surface for review?
- Cross-project propagation: promote high-confidence project rules to global?
