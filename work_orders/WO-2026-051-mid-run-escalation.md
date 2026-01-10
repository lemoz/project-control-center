---
id: WO-2026-051
title: Mid-run escalation mechanism
goal: Enable builder to pause runs and request user help when genuinely stuck, preserving progress.
context:
  - server/runner_agent.ts (builder execution)
  - server/routes.ts (run endpoints)
  - app/components/RunDetails.tsx (run UI)
  - WO-2026-050 (resourceful posture - escalation is last resort)
acceptance_criteria:
  - Builder can emit escalation marker when genuinely stuck
  - Runner detects marker, pauses (not kills) builder subprocess
  - Run enters "waiting_for_input" status
  - UI displays escalation request with input form
  - User submits input via UI
  - Runner resumes builder with input injected into context
  - Run continues from where it paused
non_goals:
  - Automatic retry logic
  - Timeout/expiration policy for waiting runs (future enhancement)
  - Notification system (email/Slack) for escalations (future enhancement)
stop_conditions:
  - Subprocess pause/resume complexity on different platforms
priority: 2
tags:
  - runner
  - ux
  - agent-behavior
estimate_hours: 4
status: done
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on:
  - WO-2026-050
era: v1
---
## Problem

When a builder is genuinely stuck (after trying - see WO-2026-050), it currently has two options:
1. Fail the run entirely
2. Fabricate completions (bad)

Neither is ideal. Failing loses all progress. The builder might be 80% done and just need one piece of information (a credit card, a credential, a decision).

## Solution

Add a mid-run escalation mechanism that:
1. Pauses the run (preserves progress)
2. Surfaces the request to the user
3. Resumes with user input

### 1. Escalation Format

Builder emits when genuinely stuck:

```
<<<NEED_HELP>>>
what_i_tried: |
  1. Attempted to create Stripe account via browser
  2. Got through email verification
  3. Blocked at identity verification requiring SSN
what_i_need: |
  This requires your personal SSN for identity verification.
  Please complete Stripe identity verification and provide the API keys.
inputs:
  - key: stripe_publishable_key
    label: Stripe Publishable Key
  - key: stripe_secret_key
    label: Stripe Secret Key
<<<END_HELP>>>
```

Key fields:
- `what_i_tried` - Demonstrates genuine effort (required by posture)
- `what_i_need` - Clear ask for the user
- `inputs` - Structured inputs needed to continue

### 2. Runner Changes

In `runner_agent.ts`:

```typescript
// Detect escalation in builder output
const ESCALATION_REGEX = /<<<NEED_HELP>>>([\s\S]*?)<<<END_HELP>>>/;

// When detected:
// 1. Parse the escalation request
// 2. Save to run record
// 3. Pause subprocess (send SIGSTOP or equivalent)
// 4. Update run status to 'waiting_for_input'
// 5. Emit event for UI refresh
```

### 3. New Run Status

```typescript
type RunStatus =
  | 'pending'
  | 'building'
  | 'waiting_for_input'  // NEW
  | 'reviewing'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'cancelled';
```

### 4. Database Schema Addition

```typescript
interface Run {
  // ... existing fields
  escalation?: {
    what_i_tried: string;
    what_i_need: string;
    inputs: Array<{ key: string; label: string }>;
    created_at: string;
    resolved_at?: string;
    resolution?: Record<string, string>;
  };
}
```

### 5. Resume API

New endpoint: `POST /api/runs/:runId/provide-input`

```typescript
// Request body
{
  inputs: {
    stripe_publishable_key: "pk_live_xxx",
    stripe_secret_key: "sk_live_xxx"
  }
}

// Handler:
// 1. Validate all required inputs provided
// 2. Store resolution in run.escalation
// 3. Inject inputs into builder context (append to conversation or env)
// 4. Resume subprocess (SIGCONT or equivalent)
// 5. Update status to 'building'
```

### 6. UI Changes

In `RunDetails.tsx`, when status is `waiting_for_input`:

```tsx
<EscalationPanel>
  <h3>Builder needs your help</h3>

  <Section title="What was tried">
    {escalation.what_i_tried}
  </Section>

  <Section title="What's needed">
    {escalation.what_i_need}
  </Section>

  <Form>
    {escalation.inputs.map(input => (
      <Input key={input.key} label={input.label} name={input.key} />
    ))}
    <Button onClick={submitInputs}>Provide & Resume</Button>
  </Form>
</EscalationPanel>
```

### 7. Input Injection

When resuming, inject the user's input into builder context. Options:
- Append as a system message: "User provided: stripe_publishable_key=pk_live_xxx"
- Write to a temp file builder can read
- Inject as environment variables

Simplest is probably appending to the conversation/context.

## Files to Modify

1. `server/runner_agent.ts` - Escalation detection, pause/resume
2. `server/routes.ts` - Add `/runs/:id/provide-input` endpoint
3. `server/db.ts` - Add escalation fields to run schema
4. `app/components/RunDetails.tsx` - Escalation UI panel
5. `lib/types.ts` - Update RunStatus type, add Escalation type

## Testing

1. Create a WO that will trigger escalation (e.g., "Set up Stripe payments")
2. Builder attempts, hits real blocker, escalates
3. Verify run status is `waiting_for_input`
4. Verify UI shows escalation panel
5. Provide test inputs
6. Verify run resumes and uses inputs
7. Verify run completes successfully

## Future Enhancements

- Notification when run needs input (email, Slack)
- Timeout policy for stale waiting runs
- Multiple escalations per run (if builder gets stuck again)
- Escalation analytics
