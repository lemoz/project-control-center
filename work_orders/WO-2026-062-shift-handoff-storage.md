---
id: WO-2026-062
title: Shift Handoff Storage
goal: Create storage and API for shift handoff notes so agents can leave context for the next shift.
context:
  - docs/agent_shift_protocol.md (WO-2026-060)
  - server/db.ts (schema patterns)
  - Handoff is critical for continuity between shifts
acceptance_criteria:
  - Database table for shift_handoffs
  - Schema captures what was done, what's next, blockers, recommendations
  - Schema includes decisions_made (decision + rationale) for future agents to understand WHY
  - API to create handoff (POST /projects/:id/shifts/:shiftId/handoff)
  - API to read latest handoff (included in shift-context)
  - Handoffs are immutable (append-only history)
non_goals:
  - UI for viewing handoffs (future WO)
  - Handoff templates or validation
  - Cross-project handoffs
stop_conditions:
  - If schema becomes complex, start with freeform text + structured recommendations
priority: 2
tags:
  - autonomous
  - storage
  - continuity
estimate_hours: 2
status: backlog
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on:
  - WO-2026-060
era: v2
---

## Implementation

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS shift_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shift_id TEXT,  -- Links to shift if we track them

  -- What happened
  summary TEXT NOT NULL,
  work_completed TEXT,  -- JSON array of WO IDs or descriptions

  -- For next shift
  recommendations TEXT,  -- JSON array of strings
  blockers TEXT,         -- JSON array of strings
  next_priorities TEXT,  -- JSON array of strings

  -- For future agents to understand WHY
  decisions_made TEXT,   -- JSON array of {decision, rationale}

  -- Context
  agent_id TEXT,         -- Who/what took the shift
  duration_minutes INTEGER,

  created_at TEXT NOT NULL,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shift_handoffs_project_created
  ON shift_handoffs(project_id, created_at DESC);
```

### TypeScript Types

```typescript
interface ShiftHandoff {
  id: string;
  project_id: string;
  shift_id: string | null;
  summary: string;
  work_completed: string[];
  recommendations: string[];
  blockers: string[];
  next_priorities: string[];
  decisions_made: Array<{
    decision: string;
    rationale: string;
  }>;
  agent_id: string | null;
  duration_minutes: number | null;
  created_at: string;
}

interface CreateHandoffInput {
  summary: string;
  work_completed?: string[];
  recommendations?: string[];
  blockers?: string[];
  next_priorities?: string[];
  decisions_made?: Array<{
    decision: string;
    rationale: string;
  }>;
  agent_id?: string;
  duration_minutes?: number;
}
```

### API Endpoints

```typescript
// Create handoff
POST /projects/:id/handoffs
Body: CreateHandoffInput
Returns: ShiftHandoff

// List recent handoffs
GET /projects/:id/handoffs?limit=10
Returns: ShiftHandoff[]

// Get latest handoff (convenience)
GET /projects/:id/handoffs/latest
Returns: ShiftHandoff | null
```

### Files to Modify

1. `server/db.ts` - Add table, types, CRUD functions
2. `server/index.ts` - Add endpoints
