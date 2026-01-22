# WO-2026-137 Project Communication System Research

**Status: Research Complete**

## Current Escalation System

### 1) Run-level escalations (builder -> user input)
- **Storage:** `runs.escalation` JSON field in `control-center.db` (`server/db.ts`).
- **Trigger:** Builder emits `<<<NEED_HELP>>>` block; runner pauses process and waits (`server/runner_agent.ts`).
- **Resolution:** `POST /runs/:runId/provide-input` writes resolution into `runs.escalation`; runner resumes.
- **Surface area:** Global context includes unresolved run escalations as `type: "run_input"` (`server/global_context.ts`).

### 2) Routing escalations (project -> global -> user)
- **Storage:** `escalations` table (`server/db.ts`) with:
  - `id`, `project_id`, `run_id`, `shift_id`, `type`, `summary`, `payload`, `status`, `claimed_by`, `resolution`,
    `created_at`, `resolved_at`.
  - Status lifecycle: `pending -> claimed -> (optional) escalated_to_user -> resolved`; `escalated_to_user` can be set from `pending` or `claimed`, and resolve can happen from `pending`, `claimed`, or `escalated_to_user`.
- **API:** `POST /projects/:id/escalations`, `GET /global/escalations`, `POST /escalations/:id/claim|resolve|escalate-to-user` (`server/index.ts`).
- **Types:** `need_input`, `blocked`, `decision_required`, `error`, `budget_warning`, `budget_critical`, `budget_exhausted`, `run_blocked` (`server/db.ts`).
- **Global agent handling:** Uses global context + prompt (`server/global_context.ts`, `server/prompts/global_decision.ts`) to decide `RESOLVE|DELEGATE|REPORT|WAIT` (`server/global_agent.ts`).

### What gets injected today
- **Global agent:** Receives escalation queue built from run escalations + escalations table entries (only `escalated_to_user` are queued for routing escalations).
- **Project shift context:** No explicit list of open communications or escalations; only `last_human_interaction` includes `escalation_response` when run input was resolved (`server/shift_context.ts`).

## Limitations
- Two parallel escalation systems with different payload shapes and lifecycles.
- No shared model for non-blocking communications (message/request/suggestion/status).
- `escalations` table lacks explicit sender/recipient metadata (beyond `project_id`).
- No read/ack semantics for non-blocking messages.
- Project shift context does not include pending comms; agents must poll elsewhere.
- No project-to-project messaging (all routing is global or user).

## Communication Intents (Proposed)
- **escalation:** Blocking; requires resolution to continue.
- **request:** Non-blocking ask for help/resources.
- **message:** FYI or knowledge sharing.
- **suggestion:** Global -> Project recommendation (non-binding).
- **status:** Project -> Global progress update or completion signal.

## Proposed Unified `ProjectCommunication` Model (High-Level)

```ts
type ProjectCommunication = {
  id: string;
  intent: "escalation" | "request" | "message" | "suggestion" | "status";
  type?: string | null; // escalation subtype; optional for non-escalation
  from_scope: "project" | "global" | "user";
  from_project_id?: string | null;
  to_scope: "global" | "project" | "user";
  to_project_id?: string | null;
  to_project_ids?: string[] | null; // broadcast or multi-target
  run_id?: string | null;
  shift_id?: string | null;
  work_order_id?: string | null;
  summary: string;
  body?: string | null;
  payload?: string | null; // JSON
  priority?: number | null;
  status: "open" | "claimed" | "accepted" | "resolved" | "declined" | "acknowledged" | "closed";
  created_at: string;
  updated_at?: string | null;
  read_at?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};
```

**Intent lifecycles (keep simple):**
- **escalation:** `open -> claimed -> resolved` (optional `escalated_to_user` flag/status; resolve can happen from `open` or `claimed`).
- **request:** `open -> accepted|declined -> closed`.
- **message/status/suggestion:** `open -> read -> acknowledged? -> closed`.

## How the Global Agent Consumes/Routes Communications
- **Global context:** Include a unified communications queue grouped by intent + priority.
- **Routing:** Global agent triages items addressed to `to_scope=global`, then:
  - Resolves when possible.
  - Forwards to project(s) or user if needed.
  - Emits suggestions or status acknowledgements without commanding projects.
- **Prompts:** Replace escalation-only summary with intent summaries (escalations + requests first).

## How Project Shifts Send/Receive Communications
- **Send:** Project agent can create `ProjectCommunication` records for requests, messages, or status updates.
- **Receive:** Shift context should include a compact inbox:
  - Unread or open communications addressed to the project.
  - Pending outbound requests/escalations awaiting response.
- **Run-level escalation:** Remains for blocking builder input; optionally link to a communication record for visibility.

## Project-to-Project Direct Messaging
- Allow `from_project_id` -> `to_project_id` communications with intent `message|request|suggestion`.
- **Routing options:**
  - **Direct:** Delivered to the target project's shift context.
  - **Mediated:** Use `to_scope=global` to let the global agent decide routing.
- **Autonomy principle:** Suggestions are optional; requests can be declined.

## Impact on Existing Escalation Infrastructure
- **Global context aggregation:** Switch from "two escalation sources" to "communications + run escalations."
- **Escalation routing:** Existing endpoints can remain as wrappers for `intent=escalation`.
- **Type field:** Preserve `type` as a subtype under `intent=escalation`.
- **User deferrals:** Existing batching/quiet-hours logic can apply to `intent=escalation` (and optionally `request`).
- **Run escalations:** Keep `runs.escalation` for pause/resume semantics; consider linking to communications for visibility.

## Recommendation: Extend vs Replace
- **Recommend extend:** Evolve the existing `escalations` table into a unified `project_communications` model by adding `intent`, sender/recipient metadata, and read/ack fields. Keep existing columns and endpoints as backward-compatible wrappers for escalation intent.
- **Why:** Minimal migration, preserves current routing, avoids dual systems.
- **Sufficiency check:** Current escalation system is sufficient for blocking input only; it does not satisfy cross-project or non-blocking communication needs without extension.
