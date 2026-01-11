---
id: WO-2026-058
title: Include VM test results in reviewer prompt
goal: Give reviewer visibility into actual VM test results so it doesn't flag false positives from builder's sandbox failures.
context:
  - server/runner_agent.ts (buildReviewerPrompt, reviewer iteration logic)
  - "Incident: Reviewer flagged TEST GAP because builder's local npm test failed with EPERM, even though VM tests passed 22/22"
  - Builder runs in Codex sandbox which blocks port binding
  - Tests run separately on VM via SSH and pass
  - Reviewer only sees builder_result.json which shows failed local test
acceptance_criteria:
  - Reviewer prompt includes VM test results (pass/fail count, test names if failed)
  - Reviewer can distinguish between builder's local test attempt vs actual VM test results
  - No false "TEST GAP" flags when VM tests pass but builder's local tests fail due to sandbox
non_goals:
  - Changing where builder/reviewer execute (that's WO-2026-059)
  - Modifying test execution strategy
  - Changing builder's local test behavior
stop_conditions:
  - If reviewer prompt is already too large, consider summarizing test results
priority: 2
tags:
  - runner
  - reviewer
  - testing
estimate_hours: 1
status: ready
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on: []
era: v1
---

## Problem

The reviewer sees a false positive "TEST GAP" because:

1. Builder runs `npm test` locally in Codex sandbox
2. Codex sandbox blocks port binding → `EPERM 127.0.0.1:4011`
3. Builder reports `"passed": false` in result.json
4. Runner runs tests on VM via SSH → 22/22 pass
5. Reviewer only sees builder_result.json → flags "TEST GAP"

The reviewer doesn't know that actual tests passed on VM.

## Solution

Include VM test results in the reviewer prompt:

```typescript
const reviewerPrompt = buildReviewerPrompt({
  workOrderId: workOrder.id,
  workOrderMarkdown,
  diffPatch: diffPatch || "(no changes detected)",
  constitution: reviewerConstitution.content,
  builderChanges,
  builderChangesPath: fs.existsSync(reviewerBuilderResultPath)
    ? "builder_result.json"
    : undefined,
  // NEW: Add VM test results
  vmTestResults: {
    passed: true,
    total: 22,
    failed: 0,
    summary: "22 passed (2.6m)",
  },
});
```

Update prompt template:

```markdown
## Test Results (VM)
Tests were executed on the VM and **passed**: 22/22 (2.6m)

Note: Builder's local test attempt may show failures due to Codex sandbox
restrictions (e.g., EPERM on port binding). The VM results above are authoritative.
```

## Files to Modify

- `server/runner_agent.ts` - Parse VM test results, pass to buildReviewerPrompt
- `server/runner_agent.ts` - Update buildReviewerPrompt to include test results section
