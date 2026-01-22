---
id: WO-2026-123
title: Escalation UX Improvements
goal: Make escalation handling visible, actionable, and time-bounded so runs don't get stuck waiting for input indefinitely.
context:
  - Runs can hit escalation when builder needs user input (missing deps, manual verification, etc.)
  - Currently no UI to resolve escalations - must call API manually
  - Runs can sit in waiting_for_input forever (e.g., WO-006 stuck for 149+ hours)
  - Escalation details buried in JSON column, hard to discover
  - AGENTS.md now documents the flow, but tooling is missing
acceptance_criteria:
  - Escalation resolution UI on run detail page when status = waiting_for_input
  - UI shows what_i_tried, what_i_need from escalation record
  - UI renders input form based on inputs array with labels
  - Submit button calls POST /runs/:id/provide-input
  - New alert type "Escalation awaiting input" in observability dashboard
  - Alert links directly to run detail page for resolution
  - Configurable auto-cancel timeout for stuck escalations (default 24h)
  - Alert severity escalates over time (warning at 1h, critical at 12h)
  - Run logs clearly show escalation request details (not just "waiting for input")
non_goals:
  - Changing the escalation protocol itself
  - Auto-resolving escalations with AI
  - Email/Slack notifications (future enhancement)
stop_conditions:
  - If escalation record format changes, update AGENTS.md documentation
priority: 2
tags:
  - ux
  - escalation
  - observability
  - runner
estimate_hours: 6
status: backlog
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---

## Overview

Escalation handling currently requires manual API calls and has no visibility in the UI. This leads to runs getting stuck in `waiting_for_input` status indefinitely.

## Implementation Areas

### 1. Escalation Resolution UI

On the run detail page (`/projects/:id/runs/:runId`), when `status === "waiting_for_input"`:

- Display card/panel showing escalation details:
  - `what_i_tried` - formatted text
  - `what_i_need` - formatted text
- Render form with input fields based on `inputs` array
- Each input has `key` and `label` from the escalation record
- Submit button calls `POST /runs/:runId/provide-input`
- Show success/error feedback

### 2. Escalation Alerts

Add to observability system (`server/observability.ts`):

- New alert type: `escalation_waiting`
- Query runs with `status = 'waiting_for_input'`
- Include `run_id`, `work_order_id`, `waiting_since` in alert
- Severity based on duration:
  - `warning` at 1 hour
  - `critical` at 12 hours
- Link to run detail page in alert

### 3. Auto-Cancel Timeout

- Add server setting: `ESCALATION_TIMEOUT_HOURS` (default: 24)
- Background job checks for stuck escalations
- Auto-cancel runs exceeding timeout
- Log reason: "Escalation timeout - no input provided within {X} hours"

### 4. Better Logging

When escalation is requested, log:
```
[timestamp] Escalation requested:
  What was tried: {what_i_tried}
  What is needed: {what_i_need}
  Required inputs: {input keys}
```

## API Reference

Existing endpoint for resolution:
```
POST /runs/:runId/provide-input
Content-Type: application/json

{
  "key1": "value1",
  "key2": "value2"
}
```

## Testing

- Create a test run that triggers escalation
- Verify UI form appears and submits correctly
- Verify alerts appear in observability dashboard
- Verify auto-cancel works after timeout
