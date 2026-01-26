---
id: WO-2026-052
title: Convert scope creep into backlog WOs
goal: When reviewer detects out-of-scope changes, capture them as new backlog WOs instead of just rejecting.
context:
  - server/runner_agent.ts (reviewer logic)
  - Observation: builders frequently make legitimate improvements outside WO scope
  - Current behavior: reviewer rejects, builder reverts, insight is lost
acceptance_criteria:
  - Reviewer can flag changes as "out of scope but interesting"
  - Flagged changes are captured as draft WOs in backlog
  - Builder is instructed to revert the out-of-scope changes
  - Draft WO includes context (what file, what change, why it seemed useful)
  - Original WO run continues without the scope creep
non_goals:
  - Automatically approving scope creep
  - Builder deciding what's in/out of scope
  - Complex WO generation from diffs
stop_conditions:
  - If draft WO quality is too low to be useful, simplify to just logging
priority: 3
tags:
  - reviewer
  - workflow
  - backlog
estimate_hours: 3
status: you_review
created_at: 2026-01-10
updated_at: 2026-01-26
depends_on: []
era: v1
---
## Problem

Builders frequently make changes outside WO scope. Current pattern:

1. Builder implements WO + notices something else worth fixing
2. Builder makes the "improvement" alongside WO work
3. Reviewer catches scope creep, requests revert
4. Builder reverts, insight is lost
5. Same "improvement" keeps appearing in future runs

Examples from recent runs:
- `playwright.config.ts` HOME/USERPROFILE env overrides (appeared in 3 WOs)
- `e2e/smoke.spec.ts` Kanban column assertion tightening (appeared in 4 WOs)
- `ConstitutionPanel.tsx` expand/collapse UI (appeared in 2 WOs)

These might be legitimate improvements, but we lose them by just rejecting.

## Solution

When reviewer detects scope creep:

1. **Flag as "out of scope but potentially useful"**
2. **Generate draft WO** capturing the change:
   ```yaml
   id: WO-2026-XXX
   title: [Auto] Tighten Kanban column test assertions
   goal: Improve test reliability by using exact column text matching
   context:
     - Surfaced during WO-2026-049 review
     - File: e2e/smoke.spec.ts:343-345
   status: backlog
   tags:
     - auto-generated
     - from-scope-creep
   ```
3. **Instruct builder to revert** the out-of-scope changes
4. **Continue with original WO**

### Reviewer Output Format

```json
{
  "verdict": "changes_requested",
  "notes": ["Revert out-of-scope changes to playwright.config.ts"],
  "scope_creep_wos": [
    {
      "title": "Add HOME/USERPROFILE to Playwright env for test isolation",
      "file": "playwright.config.ts",
      "lines": "12, 55",
      "rationale": "Builder attempted this to fix test isolation issues"
    }
  ]
}
```

### Runner Processing

When `scope_creep_wos` is present:
1. Create draft WO files in `work_orders/` with `status: backlog`
2. Log that WOs were auto-generated
3. Continue normal flow (builder reverts, retries)

## Files to Modify

- `server/runner_agent.ts` - Update reviewer prompt to output scope_creep_wos, process into draft WOs
- `server/work_orders.ts` - Add function to create draft WO from scope creep data

## Benefits

- No more lost insights
- Recurring scope creep becomes visible (same WO keeps getting auto-generated = signal)
- Maintains discipline while capturing value
- Backlog grows organically from actual builder observations
