# WO-2026-142 Supervised Autonomous Session Research

Status: Research Complete

## Scope
- Global agent sessions only (global chat scope).
- Session flow and system integration, not detailed UI design or implementation.

## Current System Summary

### Chat system (global chat scope)
- UI entrypoint: `app/chat/page.tsx` uses `ChatOverlayLauncher` to open the chat overlay.
- UI overlay: `app/components/ChatWidget.tsx` + `app/components/ChatThread.tsx` render threads, messages,
  run logs, and action controls.
- Server: `server/chat_agent.ts` runs chat via a CLI provider (Codex), with access gating and pending
  confirmations for write/network permissions.
- Data model: `chat_threads`, `chat_messages`, `chat_runs`, `chat_run_commands`, and
  `chat_action_ledger` in `server/db.ts`.
- Capabilities: chat messages can carry actions (work order updates, start runs, merges), and chat can
  operate in isolated worktrees.

### Global shift system
- Entry: `server/global_agent_worker.ts` runs `runGlobalAgentShift` in `server/global_agent.ts`.
- Context: `server/global_context.ts` assembles portfolio state; prompt built in
  `server/prompts/global_decision.ts`.
- Actions supported: `DELEGATE` project shift, resolve escalations, create project, report to user,
  or wait.
- Data model: `global_shifts` and `global_shift_handoffs` tables in `server/db.ts`.
- Integration with chat: only `REPORT` writes a message to the global chat thread.

### Gaps
- No shared session state between chat and global shifts.
- No explicit briefing phase or goal confirmation before autonomous execution.
- Global shift runs are typically single-iteration (default maxIterations = 1).
- No progress check-ins or status reporting loop beyond manual `REPORT`.
- No UI for starting, pausing, or stopping autonomous mode from global chat.
- No linkage between chat history and global decision prompt.

## Proposed Session Phases

### Phase 1: Briefing (Chat)
Goal: align on objectives, priorities, constraints, and stopping rules.
- User and agent converse in global chat as normal.
- Agent summarizes goals into a structured briefing snapshot.
- User explicitly confirms the briefing snapshot before autonomous starts.
- Output: session briefing summary, goals list, constraints, priority projects, and exclusions.

### Phase 2: Autonomous (Shift Loop)
Goal: run global agent decisions in a bounded loop with periodic check-ins.
- Autonomous loop executes multiple iterations of the global decision cycle.
- Each iteration logs decisions/actions and updates session progress.
- Check-ins report progress, request guidance, or surface alerts.
- Stops on completion, limits, or user interruption.

### Phase 3: Debrief (Chat)
Goal: summarize outcomes and capture next steps.
- Agent posts a debrief message to chat with outcomes and recommendations.
- User can ask follow-ups or start a new session.
- Session transitions to `ended`.

## Briefing -> Autonomous Context Transfer

Recommended approach: summarize and structure chat context into a session briefing snapshot,
then inject it into the global decision prompt.

Briefing snapshot (example shape):
- goals: [string]
- priority_projects: [string or project_id]
- constraints: { max_budget_usd?, max_duration_minutes?, max_iterations?, do_not_touch? }
- success_criteria: [string]
- notes: short narrative summary (3-5 lines)
- source_message_ids: [string] (range of chat messages included)
- confirmed_at: timestamp

Prompt transfer:
- Extend `buildGlobalDecisionPrompt` to include a "Session Briefing" block with goals, constraints,
  and priorities.
- Include a short "Briefing Summary" paragraph instead of raw chat history to control token size.
- Add "Session Stop Conditions" so the agent can self-terminate appropriately.

## Multi-Iteration Shift Loop with Check-ins

Loop structure (per session):
1. Load session record + global context.
2. Build global decision prompt with session briefing + prior session decisions.
3. Execute decision (delegate, resolve, report, wait, etc.).
4. Append decision/action to session history.
5. Emit check-in when triggers fire.
6. Stop or continue based on limits and status.

Check-in triggers:
- Time-based: every N minutes (default 20-30).
- Event-based: escalation handled, run started/completed, error surfaced.
- Threshold-based: decisions count, budget spent, or iterations reached.
- Guidance: agent uncertainty triggers a pause and a question.

Check-in types:
- Progress update (no response needed).
- Guidance request (blocks until user response).
- Alert (budget/time limit reached or critical error).
- Completion (transition to debrief).

## UI Elements Needed (Global Chat)
- Briefing summary card with "Edit" + "Start autonomous" actions.
- Session status banner with mode indicator (Briefing / Autonomous / Debrief).
- Progress stats: time elapsed, iterations, decisions, budget spent.
- Control buttons: Pause, Resume, Stop and Debrief.
- Check-in feed (latest update pinned above chat).
- Debrief entry with "Start new session" and "End".

## Interruption and Early Termination

Recommended behavior:
- If user sends a message during autonomous:
  - Pause autonomous loop.
  - Treat message as briefing update.
  - Ask to resume or stop.
- If budget/time/iteration limits reached:
  - Auto-stop and move to debrief with a reason.
- If critical error:
  - Post alert check-in and request guidance; if no response, stop and debrief.
- Manual stop:
  - Immediate transition to debrief with current progress summary.

## Proposed Data Model Changes

Minimal additions to support sessions while reusing existing global shifts.

1) New table: `global_agent_sessions`
- id
- chat_thread_id
- state: briefing | autonomous | debrief | ended
- goals (json)
- priority_projects (json)
- constraints (json)
- briefing_summary (text)
- briefing_source_message_ids (json)
- autonomous_started_at, paused_at, ended_at
- iteration_count, decisions_count, actions_count
- last_check_in_at
- created_at, updated_at

2) New table: `global_agent_session_events`
- id
- session_id
- type: briefing_confirmed | check_in | guidance | alert | completion | paused | resumed
- payload (json) (stats, messages, structured progress)
- created_at

3) Add session linkage to `global_shifts`
- session_id (nullable)
- iteration_index

Optional: `chat_threads.active_session_id` for quick lookup in the UI.

## Full User Flow (Global Agent Session)

1. User opens global chat overlay.
2. Briefing chat: user describes goals and constraints.
3. Agent generates briefing summary card; user edits if needed.
4. User presses "Start autonomous".
5. Session enters Autonomous; status banner shows progress.
6. Agent runs multi-iteration loop with periodic check-ins.
7. User may pause/stop; messages during autonomous pause the loop.
8. On completion or limits, agent posts debrief.
9. User asks follow-ups or starts a new session.

Edge cases:
- Multiple sessions started concurrently: reject or auto-archive the prior session.
- No confirmed goals: disable Start button and prompt user for minimal goals.
- Lost connection: session continues; next load shows status and last check-in.
- Silent period: send a keepalive check-in to avoid "nothing happening" UX.
- Escalation storm: batch check-ins and request guidance with a prioritized list.

## Recommendation

Use a lightweight session record plus event log, and reuse global shifts for each iteration.
This keeps the existing global decision flow intact while enabling briefing context,
status visibility, and structured debriefs.
