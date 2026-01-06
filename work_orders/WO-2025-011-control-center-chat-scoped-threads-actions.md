---
id: WO-2025-011
title: "Control Center chat: scoped threads + approval actions"
goal: Add an in-app, Codex-CLI-style chat to operate Project Control Center (global/project/work-order scopes) with explicit, reviewable actions and full audit logs.
context:
  - DECISIONS.md (summary-first UX, local-first)
  - docs/work_orders.md (card contract)
  - server/index.ts (API surface)
  - server/db.ts (SQLite schema + migrations)
  - server/settings.ts (settings pattern + env overrides)
  - app/layout.tsx (global nav)
  - app/projects/[id]/* (project/kanban UX)
acceptance_criteria:
  - "Chat scopes exist: Global, Project, Work Order; one thread per scope item (1 global thread total, 1 per project, 1 per work order)."
  - "Memory contract: the chat runner receives the last 50 messages verbatim for that thread, plus a rolling summary produced every 50 messages and included thereafter."
  - "Codex-first runner: chats execute via `codex exec` and behave like the Codex CLI (no server-side heuristic file selection/RAG); the agent discovers context by running read-only shell commands."
  - "Visibility: UI shows per-message Chat Run status (queued/running/done/failed), timestamps, duration, and a live tail of the raw Codex log."
  - "Audit: UI shows every command the agent executed (with cwd) as a structured list derived from Codex output/logs."
  - "Approval UX: assistant responses can propose explicit actions; actions do nothing until you click Apply; applied actions update the system immediately."
  - "Undo: every applied action is recorded with an undo payload where possible, and can be undone from the UI."
  - "Safety boundary: chat runs are read-only at the filesystem level; Global chat operates in a dedicated `.system/portfolio/` workspace that exposes only non-hidden repos (e.g., symlinked or mirrored), and excludes a hard denylist of common secret files (`.env*`, `*.pem`, `id_rsa`, etc.)."
  - Chat has its own provider/model/cliPath settings (Codex in v0; others stored as placeholders), stored locally with sane defaults and env overrides.
  - "Initial action set supports: create/update Work Orders; move Work Orders across statuses; star/unstar projects; hide/unhide projects (no delete-on-disk); trigger repo rescan; start a Work Order run."
non_goals:
  - Using chat to directly edit repo files or implement Work Orders (chat is for operating the Control Center, not doing the work).
  - Multiple named threads per scope, multi-user collaboration, cloud sync.
  - Timeouts/cancel controls for long-running chat runs (v0).
  - Heuristic context retrieval, embeddings, or RAG pipelines.
stop_conditions:
  - If we cannot reliably extract a structured command audit from Codex output/logs, stop and propose an alternative (e.g., running `codex exec --json` and parsing JSONL events).
  - If the denylist-based portfolio workspace is too risky or complex, stop and propose a stricter fallback (git-tracked-only mirror) rather than widening access to `$HOME`.
priority: 2
tags:
  - chat
  - ux
  - approvals
  - audit
  - runner
estimate_hours: 12
status: done
created_at: 2025-12-15
updated_at: 2026-01-02
depends_on:
  - WO-2025-004
era: v1
---
## Product intent
You should be able to “talk to the system” to manage the portfolio, projects, and cards without losing track across repos. This chat is not a replacement for Builder/Reviewer work; it is an operator console for the Control Center itself.

## Behavior: Codex-CLI style (no heuristics)
- The server should not try to guess which files/rows are relevant.
- Each chat turn is executed by Codex in a read-only sandbox; the agent can use shell commands to inspect state and decide what to do.
- The UI must make the agent’s activity visible and auditable.

## Threads and scopes
- Global thread: one total.
- Project thread: one per project id.
- Work Order thread: one per (project id, work order id).

## Actions + approvals
Assistant responses should include:
- human-readable reply
- a list of proposed actions (typed, explicit, previewable)

Actions apply only on explicit approval (“Apply”). Applied actions should be recorded in a durable action ledger and, where possible, support “Undo”.

## Notes on safety
The portfolio workspace should ensure hidden projects are not readable by Global chat and that common secret file patterns are not accessible.
