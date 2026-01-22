---
id: WO-2026-140
title: Agent-Canvas Focus Sync Research
goal: Explore how to connect agent shift decisions to canvas focus, including follow-agent mode and manual override.
context:
  - Landing page canvas should follow agent attention
  - When agent focuses on a WO, canvas highlights/zooms to it
  - Users can click to explore manually
  - Need graceful handoff between agent-driven and user-driven focus
  - Resume-following option when user is done exploring
acceptance_criteria:
  - Document how agent decisions are currently exposed
  - Propose focus sync mechanism (polling, events, websocket?)
  - Define "follow agent" vs "manual mode" states
  - Propose transition triggers (user click, idle timeout, agent event)
  - Consider visual indicators for mode state
  - Identify what "agent focus" means (current WO? decision? run?)
  - Sketch interaction flow with edge cases
non_goals:
  - Implementation
  - Canvas modifications (separate WO)
  - Real-time infrastructure changes
stop_conditions:
  - Focus on the sync/interaction model
  - Don't redesign agent decision system
priority: 3
tags:
  - research
  - ui
  - canvas
  - agent
  - ux
estimate_hours: 2
status: done
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Research Questions

1. **What is "agent focus"?**
   - The WO currently being worked on (active run)?
   - The WO the agent just decided to start?
   - The escalation being resolved?
   - The project the agent delegated to?

2. **How to detect agent focus changes?**
   - Poll shift context / runs endpoint
   - WebSocket push on agent decision
   - SSE stream of agent events
   - Shift handoff includes focus history?

3. **Follow vs Manual Mode**:
   - **Follow mode**: Canvas auto-animates to agent's focus
   - **Manual mode**: User controls canvas, agent ignored
   - Transition: User click → manual, idle timeout → follow

4. **Edge Cases**:
   - Agent changes focus while user is exploring
   - User clicks the same node agent is focused on
   - Agent has no current focus (waiting/idle)
   - Multiple things happening (parallel runs)

## Interaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      PAGE LOAD                              │
│                         │                                   │
│                         ▼                                   │
│              ┌─────────────────────┐                        │
│              │   FOLLOW AGENT      │ ← Default mode         │
│              │   Canvas tracks     │                        │
│              │   agent focus       │                        │
│              └──────────┬──────────┘                        │
│                         │                                   │
│         User clicks     │      Agent changes focus          │
│         a node          │      (decision/run start)         │
│              │          │             │                     │
│              ▼          │             ▼                     │
│    ┌─────────────────┐  │   Canvas animates to              │
│    │  MANUAL MODE    │  │   new focus point                 │
│    │  User exploring │  │                                   │
│    │  freely         │  │                                   │
│    └────────┬────────┘  │                                   │
│             │           │                                   │
│    ┌────────┴────────┐  │                                   │
│    │                 │  │                                   │
│    ▼                 ▼  │                                   │
│  Idle 30s+      User clicks                                 │
│                 "Resume following"                          │
│    │                 │                                      │
│    └────────┬────────┘                                      │
│             │                                               │
│             ▼                                               │
│    Back to FOLLOW AGENT                                     │
└─────────────────────────────────────────────────────────────┘
```

## Visual Indicators

```
┌─────────────────────────────────────────┐
│  FOLLOW MODE:                           │
│  ┌─────────────────────────────────┐    │
│  │ 👁 Following Agent              │    │
│  │ Currently: WO-2026-137          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  MANUAL MODE:                           │
│  ┌─────────────────────────────────┐    │
│  │ 🖐 Exploring · Agent on WO-137  │    │
│  │ [Resume Following]              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  AGENT IDLE:                            │
│  ┌─────────────────────────────────┐    │
│  │ 💤 Agent idle · Explore freely  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

## Data Sources

- `/projects/:id/shift-context` - Current shift state
- `/runs?status=building` - Active runs
- Agent decision log/stream (if available)
- Global shift handoffs - recent decisions

## Open Questions

1. How "smooth" should the follow animation be?
2. Should there be a preview of where agent will go next?
3. What if agent is idle for a long time? (no active focus)
4. Should visiting users see each other's cursors? (future)
