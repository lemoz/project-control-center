---
id: WO-2026-266
title: People context integration for agents
goal: Extend the shift and global context builders to include people/stakeholder information, so agents automatically know who's involved in a project and what recent interactions have occurred.
context:
  - server/shift_context.ts (ShiftContext assembly to extend)
  - server/global_context.ts (GlobalContextResponse to extend)
  - server/db.ts (people tables from WO-2026-260)
  - server/conversation_sync.ts (conversation_events from WO-2026-262)
  - prompts/shift_agent.md (shift agent prompt to document people fields)
  - "Meeting agent resolves participants to people records"
acceptance_criteria:
  - "ShiftContext extended with people section: project stakeholders with names, roles, and last interaction"
  - "GlobalContextResponse extended with people_summary: total contacts, active contacts (interacted in last 7 days), unread/pending items"
  - "Meeting agent context includes participant resolution: map meeting attendee emails to people records"
  - "Shift agent prompt (prompts/shift_agent.md) updated to document available people fields and how to use them"
  - "Project stakeholder context: when building shift context for a project, include associated people with their relationship type"
  - "Recent interactions summary: last 5 interactions per stakeholder included in context"
  - Context assembly is efficient (single query with JOINs, not N+1)
non_goals:
  - People CRUD from agent (agents read context, users manage people)
  - Agent-initiated outreach decisions (agent provides context, user decides)
  - Full conversation history in context (just recent summary)
stop_conditions:
  - If people context makes shift context too large, limit to top 5 stakeholders per project
  - If database queries are too slow, cache stakeholder summaries
priority: 2
tags:
  - agents
  - context
  - people
  - shift
estimate_hours: 3
status: ready
created_at: 2026-01-30
updated_at: 2026-01-30
depends_on:
  - WO-2026-260
  - WO-2026-262
era: v2
---
# People Context Integration for Agents

## Goal
Make agents people-aware. When the shift agent is working on a project, it should automatically know who the stakeholders are, when you last talked to them, and what channels you use. When the meeting agent joins a call, it should recognize participants as known people.

## Context
- shift_context.ts builds the comprehensive context blob that shift agents receive
- global_context.ts builds the system-wide summary for the director agent
- Both need people data to make informed decisions
- The shift agent prompt documents what fields are available

## ShiftContext Extension

### New Types
```typescript
type StakeholderContext = {
  person_id: string;
  name: string;
  role: string | null;
  company: string | null;
  relationship: string;  // from people_projects
  recent_interactions: Array<{
    channel: string;
    direction: string;
    summary: string | null;
    occurred_at: string;
  }>;
  last_interaction_at: string | null;
  preferred_channel: string | null;  // Most-used channel
};

// Added to ShiftContext
type ShiftContext = {
  // ... existing fields ...
  stakeholders: StakeholderContext[];  // People associated with the current project
};
```

### Assembly Logic
```
1. Get project_id from shift context
2. Query people_projects JOIN people WHERE project_id = X
3. For each person, get last 5 conversation_events
4. Determine preferred_channel from conversation_events frequency
5. Return as stakeholders array
```

## GlobalContextResponse Extension

### New Type
```typescript
type PeopleSummary = {
  total_contacts: number;
  active_contacts_7d: number;  // Interacted in last 7 days
  pending_items: number;       // Unanswered inbound messages
  top_contacts: Array<{
    name: string;
    last_interaction: string;
    interaction_count_7d: number;
  }>;
};

// Added to GlobalContextResponse
type GlobalContextResponse = {
  // ... existing fields ...
  people_summary: PeopleSummary;
};
```

## Meeting Agent Integration

When meeting agent receives participant list (emails from calendar invite):
```
1. For each attendee email, call identifier resolution
2. If match found: include person record in meeting context
3. Meeting agent then knows: "John Smith (CTO at Acme, stakeholder on Project X)"
4. After meeting: link meeting notes to resolved people records
```

## Shift Agent Prompt Updates

Add to `prompts/shift_agent.md`:
```markdown
## People Context
You have access to project stakeholder information:
- `stakeholders[]` — People associated with this project
  - `name`, `role`, `company` — Who they are
  - `relationship` — Their role in the project (stakeholder, client, collaborator, vendor)
  - `recent_interactions[]` — Last 5 interactions across all channels
  - `last_interaction_at` — When you last communicated
  - `preferred_channel` — Their most-used communication channel

Use this to:
- Reference stakeholders by name in work order context
- Note when key stakeholders haven't been contacted recently
- Understand project communication patterns
```

## Files to Modify
1. `server/shift_context.ts` — Add stakeholders to shift context assembly
2. `server/global_context.ts` — Add people_summary to global context
3. `server/db.ts` — Add efficient query functions for stakeholder context
4. `prompts/shift_agent.md` — Document people fields

## Technical Notes
- Use single JOIN query for stakeholders + latest interactions (not N+1)
- Limit to 10 stakeholders per project in context to control token usage
- Limit to 5 recent interactions per stakeholder
- Preferred channel: `SELECT channel, COUNT(*) FROM conversation_events WHERE person_id=? GROUP BY channel ORDER BY COUNT(*) DESC LIMIT 1`
- Cache global people_summary (refresh every 5 minutes) since it's called frequently
