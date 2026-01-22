---
id: WO-2026-148
title: Global Agent Sessions Implementation
goal: Implement supervised autonomous sessions with onboarding flow, multi-iteration shift loops, and check-ins for the global agent.
context:
  - WO-2026-142 research doc (docs/wo-2026-142-supervised-autonomous-session-research.md)
  - server/global_agent.ts (current global shift system)
  - server/chat_agent.ts (chat system)
  - app/chat/page.tsx (global chat UI)
  - Onboarding only for cold-start (no existing global state)
  - Builder/reviewer pattern with rubric for onboarding
  - Subsequent sessions skip onboarding, use saved state
  - Tier 1 priority (foundation layer)
acceptance_criteria:
  - New global_agent_sessions table (state, goals, constraints, stats)
  - New global_agent_session_events table (check-ins, alerts, state changes)
  - Link global_shifts to sessions (session_id, iteration_index)
  - Onboarding flow for cold-start with rubric checklist
  - Integration setup prompts (GitHub webhooks, Slack, Linear)
  - Multi-iteration shift loop with configurable limits
  - Check-in triggers (time, event, threshold, guidance)
  - Session state machine (onboarding, briefing, autonomous, debrief, ended)
  - User interruption pauses autonomous and prompts resume/stop
  - Debrief summary generation
  - UI status banner with mode indicator
  - UI controls (Start autonomous, Pause, Resume, Stop)
non_goals:
  - Detailed UI design (separate WO)
  - Voice interface integration
  - Project-level sessions (global only)
stop_conditions:
  - Keep session logic separate from shift logic where possible
  - If complexity grows, split onboarding into separate WO
priority: 1
tags:
  - implementation
  - autonomous
  - global-agent
  - sessions
  - onboarding
estimate_hours: 12
status: ready
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-142
era: v2
---
## Implementation Plan

### 1. Database Schema

```sql
CREATE TABLE global_agent_sessions (
  id TEXT PRIMARY KEY,
  chat_thread_id TEXT,
  state TEXT NOT NULL, -- onboarding | briefing | autonomous | debrief | ended
  
  -- Onboarding (cold-start only)
  onboarding_rubric JSON, -- checklist items with status
  integrations_configured JSON, -- {github: bool, slack: bool, linear: bool}
  
  -- Briefing
  goals JSON,
  priority_projects JSON,
  constraints JSON, -- {max_budget_usd, max_duration_minutes, max_iterations, do_not_touch}
  briefing_summary TEXT,
  briefing_confirmed_at TEXT,
  
  -- Autonomous
  autonomous_started_at TEXT,
  paused_at TEXT,
  iteration_count INTEGER DEFAULT 0,
  decisions_count INTEGER DEFAULT 0,
  actions_count INTEGER DEFAULT 0,
  last_check_in_at TEXT,
  
  -- Lifecycle
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE global_agent_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES global_agent_sessions(id),
  type TEXT NOT NULL, -- onboarding_step | briefing_confirmed | check_in | guidance | alert | paused | resumed | completion
  payload JSON,
  created_at TEXT NOT NULL
);

-- Add to global_shifts
ALTER TABLE global_shifts ADD COLUMN session_id TEXT REFERENCES global_agent_sessions(id);
ALTER TABLE global_shifts ADD COLUMN iteration_index INTEGER;
```

### 2. Onboarding Flow (Cold-Start)

Rubric checklist:
- [ ] Projects discovered and cataloged
- [ ] Success criteria defined (.control.yml)
- [ ] GitHub integration configured (optional)
- [ ] Slack notifications configured (optional)
- [ ] Linear sync configured (optional)
- [ ] Budget limits set
- [ ] User preferences captured

Builder/reviewer pattern:
1. Agent proposes onboarding state
2. User reviews rubric, marks items complete or requests changes
3. Repeat until rubric passes threshold
4. Transition to briefing or autonomous

### 3. Session State Machine

```
[start] --> onboarding (if cold-start)
onboarding --> briefing (rubric complete)
briefing --> autonomous (user confirms)
autonomous --> debrief (limits/complete/stop)
autonomous --> briefing (user interrupts)
debrief --> ended (user ends)
debrief --> briefing (new session)
```

### 4. Multi-Iteration Shift Loop

```ts
async function runSessionLoop(sessionId: string) {
  while (true) {
    const session = getSession(sessionId);
    if (session.state !== 'autonomous') break;
    if (checkLimits(session)) { transitionToDebrief(session); break; }
    
    // Run one global shift iteration
    const shift = await runGlobalAgentShift({
      sessionId,
      iterationIndex: session.iteration_count,
      briefingContext: session.briefing_summary,
      goals: session.goals,
      constraints: session.constraints,
    });
    
    updateSession(sessionId, { iteration_count: session.iteration_count + 1 });
    
    // Check-in if triggered
    if (shouldCheckIn(session, shift)) {
      emitCheckIn(session, shift);
    }
    
    // Pause if guidance needed
    if (shift.needs_guidance) {
      pauseSession(sessionId);
      break;
    }
  }
}
```

### 5. Check-in Logic

Triggers:
- Time: every 20-30 minutes
- Event: escalation handled, run completed, error
- Threshold: N decisions made, budget % spent
- Guidance: agent uncertain

Check-in types:
- Progress: stats update (no response needed)
- Guidance: question for user (blocks until response)
- Alert: limit reached or error (transitions to debrief)
- Completion: goals achieved

### 6. UI Components

```tsx
// Session status banner
<SessionBanner 
  state={session.state}
  stats={{ iterations, decisions, elapsed, budget }}
  onPause={...} onResume={...} onStop={...}
/>

// Onboarding rubric (cold-start)
<OnboardingRubric items={rubric} onUpdate={...} />

// Briefing card
<BriefingCard goals={goals} constraints={constraints} onEdit={...} onStart={...} />

// Check-in feed
<CheckInFeed events={events} onRespond={...} />
```
