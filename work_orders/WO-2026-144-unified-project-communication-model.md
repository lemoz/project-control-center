---
id: WO-2026-144
title: Unified Project Communication Model
goal: Extend the escalations table into a unified ProjectCommunication model supporting multiple intents and project-to-project messaging.
context:
  - WO-2026-137 research doc (docs/project-communication-system-research-wo-2026-137.md)
  - server/db.ts (current escalations table)
  - server/global_context.ts (escalation aggregation)
  - server/global_agent.ts (escalation handling)
  - server/shift_context.ts (project shift context)
  - Extends existing escalations table, does not replace
  - Global agent is facilitator, not command-and-control
  - Projects are autonomous, communicate via intents
acceptance_criteria:
  - Extend escalations table with intent field (escalation, request, message, suggestion, status)
  - Add sender/recipient metadata (from_scope, from_project_id, to_scope, to_project_id)
  - Add read/acknowledged timestamps for non-blocking intents
  - Update global context to include unified communications queue grouped by intent
  - Add project shift inbox showing incoming comms addressed to project
  - Enable project-to-project messaging (direct or global-mediated)
  - Preserve backward compatibility with existing escalation endpoints
  - Update global decision prompt to show intent summaries (not just escalations)
non_goals:
  - UI changes (separate WO)
  - Chat integration
  - Notification system
stop_conditions:
  - Keep migration minimal and backward compatible
  - If complexity grows, split into multiple WOs
priority: 3
tags:
  - implementation
  - autonomous
  - global-agent
  - communication
  - database
estimate_hours: 6
status: ready
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on:
  - WO-2026-137
era: v2
---
## Implementation Plan

### 1. Database Schema Extension

Extend `escalations` table (or create `project_communications` view/table):

```sql
ALTER TABLE escalations ADD COLUMN intent TEXT DEFAULT 'escalation';
ALTER TABLE escalations ADD COLUMN from_scope TEXT DEFAULT 'project';
ALTER TABLE escalations ADD COLUMN from_project_id TEXT;
ALTER TABLE escalations ADD COLUMN to_scope TEXT DEFAULT 'global';
ALTER TABLE escalations ADD COLUMN to_project_id TEXT;
ALTER TABLE escalations ADD COLUMN body TEXT;
ALTER TABLE escalations ADD COLUMN read_at TEXT;
ALTER TABLE escalations ADD COLUMN acknowledged_at TEXT;
```

### 2. Intent Lifecycles

| Intent | Statuses | Blocking |
|--------|----------|----------|
| escalation | open → claimed → resolved | Yes |
| request | open → accepted/declined → closed | No |
| message | open → read → closed | No |
| suggestion | open → acknowledged → closed | No |
| status | open → acknowledged → closed | No |

### 3. API Updates

- Existing escalation endpoints remain as wrappers for `intent=escalation`
- Add `POST /projects/:id/communications` for creating any intent
- Add `GET /projects/:id/communications/inbox` for project shift context
- Add `POST /communications/:id/read|acknowledge` for non-blocking intents

### 4. Context Integration

- `server/global_context.ts`: Build unified communications queue
- `server/shift_context.ts`: Add inbox of open comms for project
- `server/prompts/global_decision.ts`: Show intent-grouped summaries

### 5. Migration

- Backfill existing escalations with `intent='escalation'`, `from_scope='project'`, `to_scope='global'`
- No data loss, fully backward compatible
