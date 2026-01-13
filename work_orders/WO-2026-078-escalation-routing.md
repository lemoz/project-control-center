---
id: WO-2026-078
title: Escalation Routing System
goal: Route escalations from project agents to global agent, and from global agent to user.
context:
  - Project agents escalate when blocked
  - Global agent triages and batches escalations
  - User sees consolidated escalation queue
acceptance_criteria:
  - Escalation model with project_id, type, payload, status, created_at
  - Project agent can POST escalation
  - Global agent can resolve escalation or escalate to user
  - Escalation status lifecycle (pending → claimed → resolved | escalated_to_user)
  - Batch/debounce logic (don't interrupt user for every small thing)
non_goals:
  - Notification system (Slack, email) - future WO
  - Auto-resolution logic - separate WO
stop_conditions:
  - Keep simple; don't over-engineer routing rules
priority: 2
tags:
  - autonomous
  - global-agent
  - infrastructure
estimate_hours: 3
status: done
created_at: 2026-01-12
updated_at: 2026-01-13
depends_on:
  - WO-2026-077
era: v2
---
## Schema

```sql
CREATE TABLE escalations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  shift_id TEXT,
  type TEXT NOT NULL,  -- 'need_input', 'blocked', 'decision_required', 'error'
  summary TEXT NOT NULL,
  payload TEXT,  -- JSON with details
  status TEXT DEFAULT 'pending',  -- 'pending', 'claimed', 'resolved', 'escalated_to_user'
  claimed_by TEXT,  -- 'global_agent' or null
  resolution TEXT,  -- JSON with resolution details
  created_at TEXT NOT NULL,
  resolved_at TEXT,

  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

## API

```
POST /projects/:id/escalations
  - Create escalation from project agent

GET /global/escalations
  - List pending escalations across all projects

POST /escalations/:id/claim
  - Global agent claims escalation

POST /escalations/:id/resolve
  - Resolve with resolution payload

POST /escalations/:id/escalate-to-user
  - Mark as needing user attention
```

## Flow

```
Project Agent hits blocker
        ↓
POST /projects/:id/escalations
        ↓
Global Agent polls /global/escalations
        ↓
Can resolve? → POST /escalations/:id/resolve → Project continues
        ↓ (no)
POST /escalations/:id/escalate-to-user
        ↓
User sees in UI, provides input
        ↓
POST /escalations/:id/resolve
        ↓
Project agent continues
```
