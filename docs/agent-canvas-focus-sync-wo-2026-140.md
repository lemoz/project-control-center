# WO-2026-140 Agent-Canvas Focus Sync Research

**Status: Research Complete**

## Current Exposure of Agent Decisions
- `/projects/:id/shift-context`
  - `active_runs`: `{ id, work_order_id, status, started_at }` for non-terminal runs.
  - `recent_runs`: recent run history.
  - `last_handoff`: includes `decisions_made`, `next_priorities`, `summary`, etc.
  - `last_human_interaction`: used to infer recent attention.
- `/projects/:id/shifts/active` returns the active shift (includes `agent_id`).
- `/projects/:id/shifts` returns shift history (handoff linkage).
- `/repos/:id/runs?limit=...` returns full run list with status + `work_order_id`.
- `/runs/:runId/logs/tail` can show runtime activity, but is unstructured for focus events.

There is no explicit "agent focus" field today; focus must be inferred from runs and shift handoffs.

## Definition: "Agent Focus"
Proposed resolution order (highest priority first):
1. Active run with `waiting_for_input` (needs human attention).
2. Active run with `ai_review` or `you_review` (review focus).
3. Active run with `testing`.
4. Active run with `building`.

If multiple runs share priority, pick the most recent `started_at`.
If there are no active runs:
- If an active shift exists, derive from `last_handoff.decisions_made` or `next_priorities`
  by extracting the first WO id; otherwise fall back to the project node.
- If no shift + no recent handoff: focus = none (agent idle).

Suggested focus object:
- `kind`: `work_order` | `project` | `none`
- `work_order_id` (optional)
- `run_id` (optional)
- `status` (optional)
- `source`: `active_run` | `handoff` | `idle`
- `updated_at`

## Focus Sync Mechanism (No New Realtime Infra)
- Poll `/projects/:id/shift-context` every 5-10s.
- Optionally cross-check `/projects/:id/shifts/active` and `/repos/:id/runs` if needed.
- Compute focus from the resolution rules above.
- Animate only when focus changes; ignore identical focus events.
- Back off polling when the page is hidden.

Future (out of scope): SSE/WS for push focus updates.

## Mode Model
- `follow`: canvas auto-centers/zooms to agent focus changes.
- `manual`: user-driven camera; agent focus is highlighted only.
- `pending_focus`: a flag while in manual mode indicating agent focus changed.

## Transition Triggers
- `follow` -> `manual`: user clicks a node, drags, pans, zooms, or searches.
- `manual` -> `follow`: user clicks "Resume following" or idle timeout (suggest 30s).
- Agent focus change:
  - If `follow`: auto-animate to new focus.
  - If `manual`: set `pending_focus` and show indicator only.

## Visual Indicators
- Mode chip in a consistent corner:
  - Follow: "Following agent" + current WO label.
  - Manual: "Manual" + "Agent on WO-xxxx" + "Resume following".
  - Idle: "Agent idle" (no active focus).
- Always highlight the agent-focused node (ring or glow), even in manual mode.
- If `pending_focus`: small badge "Agent moved to WO-xxxx".

## Interaction Flow + Edge Cases
1. Page load -> follow mode -> focus resolved (active run or idle).
2. User pans/zooms -> manual mode.
3. Agent focus changes while manual -> highlight target node + badge; no camera move.
4. User resumes or idle timeout -> animate to pending focus and return to follow.

Edge cases:
- User clicks the same node as agent focus: stay in manual unless user explicitly resumes;
  optional auto-resume if the camera is already centered and no dragging occurred.
- Multiple active runs: apply priority ordering; optionally show a secondary run count.
- Agent idle for long time: keep last focus but show idle indicator; avoid auto motion.
- Burst focus changes: debounce to the latest focus (300-500ms).
- Handoff decisions without WO ids: focus remains on project node.

## Open Decisions
- Poll cadence vs UI responsiveness (default 5s with backoff).
- Whether to auto-resume follow when user selects the agent-focused node.
- Idle timeout duration (30s suggested, tune by usage).
