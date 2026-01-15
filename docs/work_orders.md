# Work Orders

Work Orders are the unit of work and Kanban cards in Project Control Center. They are Markdown files with YAML frontmatter.

## Location
Each repo stores its Work Orders in `work_orders/`.

## Frontmatter contract

Required fields for a card to be **Ready**:

```yaml
---
id: WO-YYYY-NNN
title: "Short name"
goal: "What changes when done"
context:
  - "Links/notes to relevant files or docs"
acceptance_criteria:
  - "Observable, testable outcomes"
non_goals:
  - "Explicit exclusions"
stop_conditions:
  - "When to halt and report instead of guessing"
priority: 1-5
tags: ["theme", "area"]
estimate_hours: 0.5
status: backlog|ready|building|ai_review|you_review|done|blocked|parked
created_at: "YYYY-MM-DD"
updated_at: "YYYY-MM-DD"
---
```

Optional fields (can be added to the frontmatter as needed):
- `base_branch`: default base branch for runs when no run-level override is provided.

Everything below the frontmatter is free-form detail/spec.

## Status semantics
- `backlog`: idea exists but not specified.
- `ready`: contract complete; safe to run.
- `building`: builder agent in progress.
- `ai_review`: reviewer agent evaluating builder output.
- `you_review`: approved by reviewer; awaiting your accept/follow-up.
- `done`: accepted by you.
- `blocked`: needs input or external dependency.
- `parked`: intentionally paused; may include a parked-until date in body.

## Run flow
1. Builder agent runs against a single Ready Work Order.
2. Builder produces: git diff, summary, tests status, risks.
3. Fresh reviewer agent reviews Work Order + diff, and may run read-only inspection commands against a sanitized repo snapshot (e.g., excludes `.env*`, private keys).
4. If reviewer requests changes, builder loops until approval.
5. Tester gate runs automated checks (browser E2E smoke at minimum).
6. Only after Reviewer + Tester pass, an approved summary is surfaced to you in `you_review`.

### Tester gate (v0)
- Runs against a production-like build, not `next dev`.
- For this repo: `npm run test:e2e` (Playwright) includes desktop + mobile viewport smoke.
- On failure, the tester output should include a concise report plus artifacts (trace/video/screenshot).
