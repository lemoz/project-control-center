---
id: WO-2026-055
title: Builder blocking-fix classification
goal: Allow builders to distinguish between opportunistic improvements and fixes necessary to complete the WO.
context:
  - server/runner_agent.ts (builder prompt and output parsing)
  - Incident: Builders correctly fix blocking issues but reviewers reject as scope creep
  - WO-2026-054 (baseline gate) handles pre-existing failures; this handles mid-run discoveries
acceptance_criteria:
  - Builder output schema includes change classification (wo_implementation vs blocking_fix)
  - blocking_fix changes include reason explaining why it's necessary
  - Reviewer prompt updated to validate blocking_fix claims
  - Reviewer allows legitimate blocking fixes, rejects disguised scope creep
  - Run summary shows which changes were blocking fixes
non_goals:
  - Auto-approving all blocking_fix claims
  - Complex dependency analysis
  - Changing the iteration loop structure
stop_conditions:
  - If classification adds too much complexity to builder output, simplify to boolean flag
priority: 2
tags:
  - runner
  - builder
  - reviewer
estimate_hours: 3
status: done
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on:
  - WO-2026-054
era: v1
---
## Problem

Sometimes builders discover issues mid-run that block completion:

- A test selector is broken (not their fault, but they can't pass tests without fixing)
- A type definition is wrong (they need to fix it to implement the WO)
- An import is missing (they need to add it)

Currently, reviewers reject these as "scope creep" even when they're necessary. This creates an impossible situation - the builder can't complete the WO without the fix, but the fix is rejected.

## Solution

### 1. Builder Output Schema Update

```typescript
interface BuilderOutput {
  status: "complete" | "blocked" | "failed";
  summary: string;
  changes: Array<{
    file: string;
    type: "wo_implementation" | "blocking_fix";
    reason?: string;  // Required for blocking_fix
  }>;
}
```

Example:
```json
{
  "status": "complete",
  "summary": "Added resourceful posture to builder prompt",
  "changes": [
    {
      "file": "server/runner_agent.ts",
      "type": "wo_implementation"
    },
    {
      "file": "e2e/smoke.spec.ts",
      "type": "blocking_fix",
      "reason": "Test selector getByText('Done') matches 3 elements due to Constitution preview; added exact:true to pass tests"
    }
  ]
}
```

### 2. Builder Prompt Update

Add to builder instructions:

```markdown
## Change Classification

For each file you modify, classify the change:

- **wo_implementation**: Directly implements the Work Order
- **blocking_fix**: Fixes an issue that blocks WO completion (not part of WO scope, but necessary)

For blocking_fix changes, explain WHY it's necessary:
- What breaks without this fix?
- Why can't the WO be completed without it?

Only use blocking_fix for genuine blockers, not "nice to have" improvements.
```

### 3. Reviewer Prompt Update

Add to reviewer instructions:

```markdown
## Evaluating Blocking Fixes

When builder claims a change is a "blocking_fix":

1. Verify the claim - is it actually blocking?
   - Would tests fail without this change?
   - Is there a type error or import issue?

2. Check the reason - does it make sense?
   - Is the explanation specific and verifiable?
   - Can you confirm by inspection?

3. Decide:
   - If legitimate blocker → allow
   - If disguised scope creep → reject with note: "This doesn't appear to be a true blocker because..."
```

### 4. Run Summary Enhancement

Show blocking fixes in run details:

```
Changes:
- server/runner_agent.ts (WO implementation)
- e2e/smoke.spec.ts (Blocking fix: test selector ambiguity)
```

## Files to Modify

- `server/runner_agent.ts` - Update builder prompt and output parsing
- `server/runner_agent.ts` - Update reviewer prompt
- `app/components/RunDetails.tsx` - Show change classifications

## Relationship to Other WOs

- **WO-2026-054** (baseline gate): Catches pre-existing failures before run starts
- **WO-2026-055** (this): Handles issues discovered mid-run
- **WO-2026-052** (scope creep → backlog): Captures rejected improvements for later

Together these create a complete solution:
1. Gate catches baseline issues (054)
2. Classification allows legitimate mid-run fixes (055)
3. Rejected improvements become backlog WOs (052)
