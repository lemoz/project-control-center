---
id: WO-2026-089
title: Shift Agent VM Deployment
goal: Move the shift agent from local execution to running on VM for fully autonomous operation.
context:
  - WO-2026-074 implements local shift agent
  - Local requires user's machine to be on
  - VM deployment enables 24/7 autonomous operation
  - Chrome extension won't work on VM (headless)
acceptance_criteria:
  - Shift agent runs on VM without user machine
  - Headless browser solution (Playwright MCP or similar)
  - Agent can still research, browse, interact with web
  - Escalations queue for user (can't ask directly)
  - Logging and observability from remote execution
  - Cost controls (budget limits, auto-shutdown)
non_goals:
  - Changing shift logic (same loop, different environment)
  - GUI-based browser (headless only)
stop_conditions:
  - If headless browser is too limiting, keep local as primary
priority: 3
tags:
  - autonomous
  - orchestrator
  - vm
  - infrastructure
estimate_hours: 6
status: ready
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on:
  - WO-2026-074
  - WO-2026-078
era: v2
---
## Architecture Change

```
FROM (Local):
┌──────────────────┐         ┌──────────────────┐
│ Your Machine     │         │ VM               │
│ ┌──────────────┐ │ ──────► │ Run Execution    │
│ │ Shift Agent  │ │         │                  │
│ └──────────────┘ │         └──────────────────┘
└──────────────────┘

TO (VM):
┌──────────────────┐         ┌──────────────────┐
│ Your Machine     │         │ VM               │
│                  │ ◄────── │ ┌──────────────┐ │
│ Escalation UI    │         │ │ Shift Agent  │ │
│                  │         │ └──────────────┘ │
└──────────────────┘         │ Run Execution    │
                             └──────────────────┘
```

## Key Differences

| Aspect | Local | VM |
|--------|-------|-----|
| Browser | Chrome extension (GUI) | Playwright MCP (headless) |
| User interaction | Direct (sees output) | Async (escalation queue) |
| Availability | When machine on | 24/7 |
| Cost | Free (your machine) | VM runtime cost |
| Debugging | Easy (local) | Remote logs |

## Headless Browser Options

1. **Playwright MCP**
   - Full browser automation
   - Screenshots, navigation, interaction
   - Proven, well-maintained

2. **Puppeteer MCP**
   - Similar capabilities
   - Alternative if Playwright issues

3. **WebFetch/WebSearch only**
   - Simplest, no browser needed
   - Limited to API calls and search
   - May be sufficient for most tasks

## Escalation Flow (VM)

```
Shift agent on VM hits blocker
        ↓
POST /projects/:id/escalations
        ↓
Escalation queued (WO-2026-078)
        ↓
User checks escalation UI (or gets notified)
        ↓
User provides resolution
        ↓
POST /escalations/:id/resolve
        ↓
Shift agent continues
```

## Implementation

1. Package shift agent for VM execution
2. Install Playwright MCP on VM image
3. Configure Claude Agent SDK for VM environment
4. Implement escalation-based user interaction
5. Add remote logging/observability
6. Cost controls and auto-shutdown

## Prerequisites

- WO-2026-074 (local shift agent working)
- WO-2026-078 (escalation routing for async user interaction)
