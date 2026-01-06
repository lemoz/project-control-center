---
id: WO-2026-016
title: "Chat realtime updates (SSE + polling fallback)"
goal: Keep the chat overlay live while background threads run by adding server-sent events (SSE) for thread/message/run/attention changes, with a robust polling fallback.
context:
  - server/index.ts (API surface)
  - server/chat_db.ts (persistence)
  - app/components/ChatThread.tsx (live run polling today)
  - app/chat overlay UX (WO-2026-014)
acceptance_criteria:
  - "Server provides an SSE endpoint that emits events for: new message, run status change, action ledger apply/undo, thread updated (rename/scope/defaults), attention summary changed."
  - "Client overlay subscribes while open; updates thread list badge/state without requiring manual refresh."
  - "If SSE disconnects, the client falls back to polling at a reasonable cadence and auto-recovers."
  - "No new external dependencies are required for v0 (plain Express SSE)."
non_goals:
  - WebSockets.
  - Background push notifications when the UI is closed.
stop_conditions:
  - If SSE causes stability issues (memory/leaks), stop and ship polling-only with clear limits and backoff.
priority: 3
tags:
  - chat
  - realtime
  - sse
estimate_hours: 2
status: done
created_at: 2026-01-04
updated_at: 2026-01-06
depends_on: [WO-2025-011]
era: chat-v2
---
## Notes
- Ensure SSE respects ngrok/basic-auth exposure (no sensitive payloads beyond what the UI already renders).

## Implementation Notes
- server/chat_events.ts provides SSE event emitter and endpoint
- app/api/chat/stream/route.ts proxies SSE to frontend
- ChatThread.tsx subscribes to stream for live updates
- Events: message_created, run_status, thread_updated, attention_changed
