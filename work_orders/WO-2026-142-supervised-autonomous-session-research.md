---
id: WO-2026-142
title: Supervised Autonomous Session Research
goal: Design the briefing-autonomous-debrief flow for global agent sessions where users align on goals via chat before autonomous execution.
context:
  - server/global_agent.ts (current shift implementation)
  - server/chat_agent.ts (chat system)
  - app/chat/page.tsx (global chat UI)
  - Current state - chat and shifts are separate systems
  - User wants conversational alignment before autonomous work
  - Agent should report back when autonomous phase completes
acceptance_criteria:
  - Document current chat and shift systems and their gaps
  - Define the three phases - Briefing, Autonomous, Debrief
  - Propose how chat context transfers to shift prompt
  - Design multi-iteration shift loop with progress check-ins
  - Identify UI elements needed (start autonomous button, status indicators)
  - Consider interruption and early termination
  - Propose data model changes (session state, goals, progress)
  - Sketch the full user flow with edge cases
non_goals:
  - Implementation
  - Detailed UI design
  - Voice interface (separate WO)
stop_conditions:
  - Focus on the session flow, not individual phase details
  - Keep scope to global agent, not project-level chat
priority: 2
tags:
  - research
  - autonomous
  - global-agent
  - chat
  - ux
estimate_hours: 3
status: ready
created_at: "2026-01-22"
updated_at: "2026-01-22"
depends_on: []
era: v2
---
## Research Questions

1. **How does briefing context transfer to autonomous mode?**
   - Extract goals/priorities from chat history?
   - Explicit user confirmation of goals?
   - Structured goal input vs freeform chat?

2. **What triggers the transition to autonomous mode?**
   - User command: "Go for it" / "Start autonomous"
   - Explicit button in UI
   - Agent suggests when ready, user confirms

3. **How long does autonomous mode run?**
   - Time-bounded (run for 2 hours)
   - Goal-bounded (until WO-X completes)
   - Iteration-bounded (make 10 decisions)
   - Until agent decides to check in

4. **What are the check-in triggers during autonomous mode?**
   - Periodic (every 30 min)
   - Event-driven (run completed, escalation, error)
   - Threshold (spent $X, made N decisions)
   - Asking for guidance

5. **How does the user monitor autonomous progress?**
   - Live status in chat UI
   - Notifications/alerts
   - Dashboard view
   - Just wait for debrief

6. **How can the user interrupt autonomous mode?**
   - Stop button
   - Send a chat message
   - Close the session
   - Automatic timeout

## Phase Definitions

### Phase 1: Briefing (Chat)

```
State: BRIEFING
- User and agent converse normally
- Agent has access to global context (projects, WOs, runs, metrics)
- Discussion focuses on goals, priorities, concerns
- Agent can suggest focus areas based on context
- Ends when user triggers autonomous mode

Data captured:
- Chat history (conversation context)
- Explicit goals (if structured input used)
- Priority projects/WOs mentioned
- Any constraints (budget, time, specific WOs to avoid)
```

### Phase 2: Autonomous (Shift Loop)

```
State: AUTONOMOUS
- Agent runs in background
- Makes decisions without user input
- Executes actions (start runs, resolve escalations, etc.)
- Logs all decisions and actions
- Periodically checks in (reports to chat)
- Can pause and ask for guidance if uncertain

Shift prompt includes:
- Goals from briefing phase
- Standard global context
- Session constraints (budget, time remaining)
- Decision history within session

Check-in types:
- Progress report: "Completed X, starting Y"
- Guidance request: "WO-A and WO-B both ready, which to prioritize?"
- Alert: "Run failed, should I retry or escalate?"
- Completion: "Goals achieved, ready to debrief"
```

### Phase 3: Debrief (Chat)

```
State: DEBRIEF
- Agent summarizes autonomous phase
- Lists actions taken, outcomes, decisions made
- Highlights anything needing user attention
- User can ask follow-up questions
- Can transition back to briefing for next session

Debrief content:
- Summary of time/cost spent
- Runs started/completed/failed
- WOs progressed
- Escalations handled
- Recommendations for next session
```

## Session State Model

```typescript
interface GlobalAgentSession {
  id: string;
  state: 'briefing' | 'autonomous' | 'debrief' | 'ended';

  // Briefing phase outputs
  goals: string[];
  priority_projects: string[];
  constraints: {
    max_budget_usd?: number;
    max_duration_minutes?: number;
    max_iterations?: number;
  };

  // Autonomous phase tracking
  autonomous_started_at?: string;
  decisions_made: Decision[];
  actions_taken: Action[];
  check_ins: CheckIn[];

  // Debrief
  summary?: SessionSummary;

  // Lifecycle
  created_at: string;
  ended_at?: string;
  chat_thread_id: string;
}
```

## UI Elements Needed

```
┌─────────────────────────────────────────────────────────────────┐
│  BRIEFING MODE                                                  │
│                                                                 │
│  [Chat interface - normal conversation]                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Goals captured:                                        │    │
│  │  • Focus on VM Isolation track                          │    │
│  │  • Check research WOs when done                         │    │
│  │                                                         │    │
│  │  [Edit Goals] [Start Autonomous Mode →]                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  AUTONOMOUS MODE                                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🤖 Running autonomously                                │    │
│  │  Duration: 23 min | Decisions: 4 | Cost: $0.45          │    │
│  │                                                         │    │
│  │  Latest: Started WO-2026-133 run                        │    │
│  │                                                         │    │
│  │  [Pause] [Stop & Debrief]                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  [Chat disabled during autonomous - view progress above]        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  DEBRIEF MODE                                                   │
│                                                                 │
│  Agent: "Session complete. Here's what happened..."             │
│                                                                 │
│  [Chat interface - can discuss results]                         │
│                                                                 │
│  [Start New Session] [End]                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Edge Cases

1. **User sends message during autonomous mode**
   - Option A: Pause autonomous, handle message, resume
   - Option B: Queue message for debrief
   - Option C: Allow interrupt, transition to briefing

2. **Agent needs guidance during autonomous mode**
   - Pause and ask in chat
   - User responds, autonomous resumes
   - Timeout → make best guess or stop

3. **Budget/time limit reached**
   - Graceful stop
   - Auto-transition to debrief
   - Clear communication of why stopped

4. **All goals achieved early**
   - Auto-transition to debrief
   - Or ask if user wants to extend

5. **Error/failure during autonomous**
   - Log and continue if recoverable
   - Pause and ask if uncertain
   - Stop and debrief if critical

## Open Questions

1. Should goals be freeform or structured (pick from list)?
2. Can autonomous mode span multiple shift handoffs?
3. How does this interact with project-level shifts?
4. Should there be a "supervised" mode where user approves each decision?
