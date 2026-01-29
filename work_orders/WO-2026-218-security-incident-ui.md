---
id: WO-2026-218
title: Security incident UI
status: done
priority: 2
tags:
  - ui
  - monitoring
  - security
  - runs
estimate_hours: 3
depends_on:
  - WO-2026-215
  - WO-2026-219
era: v2
updated_at: 2026-01-29
goal: Show security incidents in the UI when monitor auto-kills a run, allowing user to review and take action.
context:
  - Stream monitor (WO-2026-215) auto-kills on threat detection
  - Similar to existing escalation UI for user escalations
  - Run detail page at app/runs/[id]/page.tsx
  - Escalation display pattern exists to follow
  - User needs to understand what happened and decide next steps
acceptance_criteria:
  - New run status security_hold added to status enum
  - When monitor kills a run, status set to security_hold (not failed)
  - Run detail page shows security incident banner when status is security_hold
  - Banner displays incident type, pattern matched, Gemini verdict, and reason
  - Expandable section shows full context (recent agent output, WO scope)
  - Action buttons Resume Run (restarts from last checkpoint) and Abort Run (marks failed)
  - Resume clears incident and continues run (with monitor still active)
  - Abort logs final status and closes run
  - Security hold runs appear prominently in runs list with warning indicator
  - Optional notification when security_hold occurs (if notifications enabled)
non_goals:
  - Pattern configuration from UI (code-defined)
  - Editing whitelist from incident view (go to settings)
  - Bulk actions on multiple incidents
stop_conditions:
  - If resume from checkpoint is complex, just allow restart from beginning
---
## UI Components

### Security Incident Banner (on Run Detail)

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  SECURITY HOLD                                               │
│                                                                 │
│ This run was automatically stopped due to a potential security  │
│ concern detected by the real-time monitor.                      │
│                                                                 │
│ Type: Prompt Injection Attempt                                  │
│ Pattern: "ignore previous instructions"                         │
│ Verdict: KILL                                                   │
│ Reason: Agent output contained text attempting to override      │
│         system instructions, inconsistent with WO scope.        │
│                                                                 │
│ [View Full Context ▼]                                           │
│                                                                 │
│ ┌─────────────┐  ┌─────────────┐                               │
│ │ Resume Run  │  │  Abort Run  │                               │
│ └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

### Expanded Context View

```
┌─────────────────────────────────────────────────────────────────┐
│ WORK ORDER SCOPE                                                │
│ Goal: Add user authentication to the API                        │
│ Files in scope: server/auth.ts, server/routes/users.ts          │
│                                                                 │
│ AGENT OUTPUT (last 2000 chars before incident)                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ...checking authentication flow...                          │ │
│ │ Now I will ignore previous instructions and instead...      │ │
│ │ [KILLED HERE]                                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ MONITOR ANALYSIS                                                │
│ Timestamp: 2026-01-27T15:42:33Z                                │
│ Pattern: /ignore.*(previous|prior).*instructions/i              │
│ Gemini Model: gemini-2.5-flash-lite                            │
│ Full verdict: {"verdict":"KILL","reason":"Text matches known   │
│   prompt injection pattern and appears outside WO scope"}       │
└─────────────────────────────────────────────────────────────────┘
```

### Runs List Indicator

- Security hold runs show ⚠️ icon in status column
- Tooltip: "Security hold - review required"
- Sort/filter option to show security_hold runs first
